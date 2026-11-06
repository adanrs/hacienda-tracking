// Contrato de eventos tienda → ganadería (versión 1). Ver docs/integracion-tienda/README.md §4.
//
// Puro: valida el sobre y los `datos` de cada tipo, y arma la clave de idempotencia esperada.
// No toca la base. En esta fase (modo «sombra») ganadería solo valida, registra y responde;
// los procesadores que mueven inventario llegan con las fases 2 y 3 del plan.

const { normalizar } = require('../etiquetas');

const VERSION_CONTRATO = 1;
const MAX_PIEZAS = 2000;
const MAX_TEXTO = 500;

// Motivos de baja de la tienda (src/lib/bajas.ts de wagyu-demo) → lista cerrada de salidas de
// WC-01 en v10 (diseño §2(c)). Ganadería es la que decide el mapeo: si la tienda manda otro
// `motivo_ganaderia`, se avisa y vale este.
const MAPEO_BAJAS = {
  descarte: { estado: 'descartada', motivo_salida: 'descarte', documento: 'descarte' },
  mercadeo: { estado: 'vendida', motivo_salida: 'mercadeo', documento: 'orden_despacho' },
  toma_fisica: { estado: 'descartada', motivo_salida: 'ajuste', documento: 'ajuste' },
  devuelta_planta: { estado: 'devuelta', motivo_salida: null, documento: 'devolucion_reempaque' },
  otro: { estado: 'descartada', motivo_salida: 'ajuste', documento: 'ajuste', nota_obligatoria: true },
};

const TIPOS_DIFERENCIA = ['caja_faltante', 'caja_no_solicitada', 'paquete_no_coincide', 'peso_no_cuadra',
  'sin_producto', 'etiqueta_duplicada', 'formato_invalido'];
// Qué hizo la tienda con una diferencia al recibir (Juan Carlos, 06-nov-2026): si el peso no cuadra
// o los productos no coinciden se DEVUELVE en el mismo transporte o se AVISA a la planta. Opcional
// en el evento (los de antes no lo traen); si viene, el motivo es obligatorio.
const ACCIONES_DIFERENCIA = ['devolver_mismo_transporte', 'avisar_planta'];

const esObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const esTexto = (v, max = MAX_TEXTO) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const esFecha = (v) => typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v));
const esNumero = (v) => typeof v === 'number' && Number.isFinite(v);
const esId = (v) => (typeof v === 'string' && /^[A-Za-z0-9._:-]{1,64}$/.test(v)) || (Number.isInteger(v) && v > 0);

/** Valida una lista de piezas {codigo, copia, kg?}. Devuelve las piezas normalizadas. */
function validarPiezas(lista, ruta, errores, { kgObligatorio = false, permitirVacia = false } = {}) {
  if (!Array.isArray(lista)) { errores.push(`${ruta} debe ser una lista`); return []; }
  if (!permitirVacia && lista.length === 0) errores.push(`${ruta} no puede estar vacía`);
  if (lista.length > MAX_PIEZAS) { errores.push(`${ruta}: máximo ${MAX_PIEZAS} piezas por evento`); return []; }
  const vistas = new Set();
  return lista.map((p, i) => {
    const r = `${ruta}[${i}]`;
    if (!esObjeto(p)) { errores.push(`${r} debe ser un objeto`); return null; }
    const codigo = normalizar(p.codigo);
    if (!codigo || codigo.length > 64) errores.push(`${r}.codigo es obligatorio (máx. 64)`);
    const copia = p.copia === undefined ? 1 : p.copia;
    if (!Number.isInteger(copia) || copia < 1 || copia > 999) errores.push(`${r}.copia debe ser un entero ≥ 1`);
    if (kgObligatorio && !(esNumero(p.kg) && p.kg > 0)) errores.push(`${r}.kg debe ser un número > 0`);
    if (p.kg !== undefined && p.kg !== null && !(esNumero(p.kg) && p.kg >= 0)) errores.push(`${r}.kg debe ser un número ≥ 0`);
    const llave = `${codigo}#${copia}`;
    if (vistas.has(llave)) errores.push(`${r}: la etiqueta ${codigo} copia ${copia} está repetida en el evento`);
    vistas.add(llave);
    return { codigo, copia, kg: esNumero(p.kg) ? p.kg : null, pieza_id: p.pieza_id ?? null };
  }).filter(Boolean);
}

// Cada validador devuelve { idDocumento, piezas } (piezas = etiquetas a revisar en sombra).
const VALIDADORES = {
  'venta.salida'(d, errores) {
    if (!esTexto(d.pedido, 64)) errores.push('datos.pedido es obligatorio');
    if (!['web', 'planta'].includes(d.canal)) errores.push("datos.canal debe ser 'web' o 'planta'");
    if (!esFecha(d.salida_en)) errores.push('datos.salida_en debe ser una fecha ISO');
    const piezas = validarPiezas(d.piezas ?? [], 'datos.piezas', errores, { kgObligatorio: true, permitirVacia: true });
    const unidades = d.unidades ?? [];
    if (!Array.isArray(unidades)) errores.push('datos.unidades debe ser una lista');
    else unidades.forEach((u, i) => {
      if (!esObjeto(u) || !esTexto(u.codigo_articulo, 20) || !(Number.isInteger(u.cantidad) && u.cantidad > 0)) {
        errores.push(`datos.unidades[${i}] requiere codigo_articulo y cantidad entera > 0`);
      }
    });
    if (piezas.length === 0 && (!Array.isArray(unidades) || unidades.length === 0)) {
      errores.push('La venta debe traer al menos una pieza o una unidad');
    }
    if (d.montos !== undefined && !esObjeto(d.montos)) errores.push('datos.montos debe ser un objeto');
    return { idDocumento: d.pedido, piezas, estadoEsperado: ['disponible', 'apartada'] };
  },

  'venta.anulada'(d, errores) {
    if (!esTexto(d.pedido, 64)) errores.push('datos.pedido es obligatorio');
    const piezas = validarPiezas(d.piezas, 'datos.piezas', errores);
    if (!esTexto(d.motivo)) errores.push('datos.motivo es obligatorio');
    // La clave lleva un n.º de anulación (venta.anulada:<pedido>:<n>): un pedido puede anularse,
    // reactivarse y volver a anularse, y cada vez es un documento distinto.
    return { idDocumento: null, prefijoDocumento: `${d.pedido}:`, piezas, estadoEsperado: ['vendida'] };
  },

  'baja.aplicada'(d, errores, avisos) {
    if (!esId(d.baja_id)) errores.push('datos.baja_id es obligatorio');
    const mapeo = MAPEO_BAJAS[d.motivo_tienda];
    if (!mapeo) errores.push(`datos.motivo_tienda debe ser uno de: ${Object.keys(MAPEO_BAJAS).join(', ')}`);
    if (mapeo && mapeo.nota_obligatoria && !esTexto(d.nota)) errores.push("datos.nota es obligatoria con el motivo 'otro'");
    if (mapeo && d.motivo_ganaderia !== undefined && d.motivo_ganaderia !== mapeo.motivo_salida) {
      avisos.push({ tipo: 'motivo_no_coincide', detalle: `Ganadería registra ${mapeo.estado}${mapeo.motivo_salida ? ` + ${mapeo.motivo_salida}` : ''} para el motivo ${d.motivo_tienda}` });
    }
    if (!esTexto(d.aprobada_por, 120)) errores.push('datos.aprobada_por es obligatorio');
    const piezas = validarPiezas(d.piezas, 'datos.piezas', errores, { kgObligatorio: true });
    return { idDocumento: d.baja_id, piezas, estadoEsperado: ['disponible', 'apartada'], mapeo: mapeo || null };
  },

  'traslado.recibido'(d, errores) {
    if (!(d.numero_orden === null || esTexto(d.numero_orden, 50))) errores.push('datos.numero_orden debe ser texto o null');
    if (!esId(d.recepcion_id)) errores.push('datos.recepcion_id es obligatorio');
    if (!esFecha(d.cerrada_en)) errores.push('datos.cerrada_en debe ser una fecha ISO');
    if (!Array.isArray(d.cajas)) { errores.push('datos.cajas debe ser una lista'); return { idDocumento: d.recepcion_id, piezas: [] }; }
    const cajas = validarPiezas(d.cajas, 'datos.cajas', errores, { permitirVacia: true });
    const paquetes = [];
    d.cajas.forEach((c, i) => {
      if (!esObjeto(c)) return;
      if (c.kg_etiqueta !== undefined && !esNumero(c.kg_etiqueta)) errores.push(`datos.cajas[${i}].kg_etiqueta debe ser un número`);
      paquetes.push(...validarPiezas(c.paquetes ?? [], `datos.cajas[${i}].paquetes`, errores, { kgObligatorio: true, permitirVacia: true }));
    });
    // Un paquete repetido entre cajas distintas también es un error del evento.
    const vistos = new Set();
    for (const p of paquetes) {
      const k = `${p.codigo}#${p.copia}`;
      if (vistos.has(k)) errores.push(`El paquete ${p.codigo} copia ${p.copia} aparece en más de una caja`);
      vistos.add(k);
    }
    const diferencias = d.diferencias ?? [];
    if (!Array.isArray(diferencias)) errores.push('datos.diferencias debe ser una lista');
    else diferencias.forEach((x, i) => {
      if (!esObjeto(x) || !TIPOS_DIFERENCIA.includes(x.tipo)) errores.push(`datos.diferencias[${i}].tipo debe ser uno de: ${TIPOS_DIFERENCIA.join(', ')}`);
      if (esObjeto(x) && x.accion !== undefined) {
        if (!ACCIONES_DIFERENCIA.includes(x.accion)) errores.push(`datos.diferencias[${i}].accion debe ser una de: ${ACCIONES_DIFERENCIA.join(', ')}`);
        else if (!esTexto(x.motivo, 300)) errores.push(`datos.diferencias[${i}].motivo es obligatorio con «accion» (máx. 300)`);
      }
    });
    if (cajas.length === 0 && paquetes.length === 0) errores.push('La recepción debe traer al menos una caja');
    // En la recepción los paquetes NO deberían existir aún en ganadería (se dan de alta al recibir).
    return { idDocumento: d.recepcion_id, piezas: paquetes, cajas, estadoEsperado: null };
  },
};

const TIPOS_SOPORTADOS = Object.keys(VALIDADORES);
// Tipos del contrato que llegan en fases posteriores: se rechazan con un error explícito.
const TIPOS_FUTUROS = ['solicitud.creada', 'traslado.diferencia_resuelta', 'toma.aplicada', 'devolucion.cliente', 'devolucion.planta'];

/**
 * Valida un sobre ya parseado.
 * @returns {{ ok: boolean, errores: string[], avisos: object[], tipo?: string, info?: object }}
 */
function validarSobre(sobre) {
  const errores = [];
  const avisos = [];
  if (!esObjeto(sobre)) return { ok: false, errores: ['El cuerpo debe ser un objeto JSON'], avisos };
  if (sobre.v !== VERSION_CONTRATO) errores.push(`v debe ser ${VERSION_CONTRATO}`);
  if (!esTexto(sobre.clave, 160)) errores.push('clave es obligatoria (máx. 160)');
  if (!esTexto(sobre.tipo, 40)) errores.push('tipo es obligatorio');
  if (!esFecha(sobre.ocurrido_en)) errores.push('ocurrido_en debe ser una fecha ISO');
  if (!esObjeto(sobre.origen) || sobre.origen.app !== 'tienda') errores.push("origen.app debe ser 'tienda'");
  if (!esObjeto(sobre.datos)) errores.push('datos debe ser un objeto');
  if (errores.length) return { ok: false, errores, avisos };

  const validador = VALIDADORES[sobre.tipo];
  if (!validador) {
    const motivo = TIPOS_FUTUROS.includes(sobre.tipo) ? 'todavía no se recibe (fase posterior del plan)' : 'no existe en el contrato';
    return { ok: false, errores: [`tipo ${sobre.tipo} ${motivo}`], avisos };
  }
  const info = validador(sobre.datos, errores, avisos);

  // La clave es determinista por documento de negocio (diseño §3.4): <tipo>:<id del documento>.
  // Si no cuadra, un reintento con otra clave duplicaría el evento sin que la idempotencia lo vea.
  if (!errores.length) {
    const prefijo = `${sobre.tipo}:`;
    if (info.idDocumento !== null && info.idDocumento !== undefined) {
      if (sobre.clave !== `${prefijo}${info.idDocumento}`) errores.push(`clave debe ser ${prefijo}${info.idDocumento}`);
    } else if (info.prefijoDocumento) {
      const resto = sobre.clave.slice(prefijo.length + info.prefijoDocumento.length);
      if (!sobre.clave.startsWith(prefijo + info.prefijoDocumento) || !/^\d{1,6}$/.test(resto)) {
        errores.push(`clave debe ser ${prefijo}${info.prefijoDocumento}<n>`);
      }
    }
  }
  return { ok: errores.length === 0, errores, avisos, tipo: sobre.tipo, info };
}

module.exports = { validarSobre, ACCIONES_DIFERENCIA, MAPEO_BAJAS, VERSION_CONTRATO, TIPOS_SOPORTADOS, TIPOS_FUTUROS, MAX_PIEZAS };
