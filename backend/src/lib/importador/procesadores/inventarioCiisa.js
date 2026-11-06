// Inventario SEMANAL que manda la planta CIISA (bodega 107 / paquetería): «INV WAGYU SEMANA nn.xlsx».
//
// Qué se lee del libro (las demás hojas se ignoran: «TARIMA n» y «TORTAS WAGYU nn» son vistas
// parciales de las mismas líneas y sumarlas duplicaría el inventario):
//   «INV GENERAL»  Tarima, Linea, Cod Barra, Codigo, Descripción, Peso, Medida (Kilos | Caja | UND),
//                  Lote, Fecha Vencimiento, Vencido, Despacho, Fecha despacho, Pedido por, Orden.
//                  Las semanas viejas no traen Medida ni Vencido, y los encabezados vienen en
//                  mayúsculas («CODIGO BARRAS»): el mapeo es por nombre normalizado, no por posición.
//   «MADURACION»   TARIMA, CODIGO, DESCRIPCION, LOTE, CAJA, PESO, FECHA DE VENCIMIENTO FRESCO, ESTATUS.
//                  Es la ÚNICA visibilidad que tiene el dueño de lo que está en custodia/maduración.
//                  No trae código de barras: el LOTE es el «Lot» legible del primal (MMDDAA + n.º de
//                  deshuese de 2 dígitos) y Excel le borra el 0 inicial (8202644 = 08/20/26, lote 44;
//                  el vencimiento fresco = empaque + 90 días lo confirma), por eso se completa a 8.
//
// Cada carga es un SNAPSHOT: no modifica cargas previas ni el resto de la app (cajas, primales,
// custodia). Re-cargar el mismo inventario (mismo contenido, aunque cambie el nombre o venga pegado)
// no crea otro snapshot: la vista previa lo marca «sin cambios» y aplicar no inserta líneas.
//
// Por línea:
//   - el código de barras se lee con lib/etiquetas.js. Casi todas son cajas (25 caracteres); las de
//     25 dígitos con código F1/FB salen «ambiguas» y se toma la lectura de caja, que es la que usa la
//     planta (su columna Lote = posiciones 14–23). Los primales con código Arreo (21136, 40108…) se
//     leen como primal;
//   - trazabilidad (lib/trazabilidadEtiqueta.js, puente fecha + lote de deshuese → reporte de
//     producción con arete):
//       con_arete         la etiqueta está completa y su lote lleva a un único arete;
//       recuperada        la etiqueta trae «xxx»/«000» en lugar del animal, pero el puente lo recupera;
//       sin_trazabilidad  no se llega a un animal (con «xxx» va con advertencia; NUNCA se toma el
//                         «xxx» como arete);
//       na                sin código de barras ni lote legible («SIN CODIGO DE BARRAS»);
//   - código fuera del catálogo de cortes → advertencia (la pantalla ofrece el alta rápida);
//   - peso vacío, no numérico o ≤ 0 → error: esa línea no entra al snapshot.
// Totales por hoja: piezas (líneas), kg (solo medida Kilos o sin medida: «Caja» y «UND» son conteos),
// trazabilidad desglosada con %, vencidos.

const crypto = require('crypto');
const ExcelJS = require('exceljs');
const { decodificar, esSinTrazabilidad, interpretarFecha } = require('../../etiquetas');
const { recuperarPorReporte } = require('../../trazabilidadEtiqueta');
const { parsearFecha } = require('../texto');
const { marcas, fechaTexto } = require('../comun');

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const r2 = (x) => Math.round(x * 100) / 100;
const r3 = (x) => Math.round(x * 1000) / 1000;
const sha256 = (x) => crypto.createHash('sha256').update(x).digest('hex');

// Encabezados por hoja (normalizados, coincidencia exacta: «codigo» no debe tomar «codigo barras»).
const COLUMNAS = {
  general: {
    tarima: ['tarima'],
    linea: ['linea'],
    codigo_barras: ['cod barra', 'cod barras', 'codigo barra', 'codigo barras', 'codigo de barras'],
    codigo: ['codigo', 'cod'],
    descripcion: ['descripcion'],
    peso: ['peso'],
    medida: ['medida'],
    lote: ['lote'],
    fecha_vencimiento: ['fecha vencimiento', 'fecha de vencimiento'],
    vencido: ['vencido'],
    despacho: ['despacho'],
    fecha_despacho: ['fecha despacho', 'fecha de despacho'],
    pedido_por: ['pedido por'],
    orden: ['orden'],
  },
  maduracion: {
    tarima: ['tarima'],
    codigo: ['codigo', 'cod'],
    descripcion: ['descripcion'],
    lote: ['lote'],
    caja: ['caja', 'box'],
    peso: ['peso'],
    fecha_vencimiento: ['fecha de vencimiento fresco', 'fecha vencimiento fresco', 'fecha de vencimiento', 'fecha vencimiento'],
    estatus: ['estatus', 'status', 'estado'],
  },
};

/** Tipo de hoja por su nombre («INV GENERAL », «MADURACION»); null = se ignora. */
function tipoDeHoja(nombre) {
  const n = norm(nombre);
  if (/^inv general/.test(n)) return 'general';
  if (/^maduracion/.test(n)) return 'maduracion';
  return null;
}

/** Valor de una celda de ExcelJS: resultado guardado de las fórmulas, texto enriquecido, etc. */
function valorCelda(celda) {
  const v = celda.value;
  if (v == null) return null;
  if (typeof v === 'object' && !(v instanceof Date)) {
    if (v.result !== undefined) return v.result;
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if (v.text !== undefined) return v.text;
    if (v.formula || v.sharedFormula) return null; // fórmula sin resultado guardado
    if (v.error) return null;
  }
  return v;
}

/** Busca la fila de encabezados (primeras 10) y devuelve { fila, mapa: clave → índice de columna }. */
function mapearEncabezado(filas, tipo) {
  const defs = COLUMNAS[tipo];
  for (let i = 0; i < Math.min(filas.length, 10); i++) {
    const mapa = {};
    (filas[i] || []).forEach((celda, col) => {
      const n = norm(celda);
      if (!n) return;
      for (const [clave, variantes] of Object.entries(defs)) {
        if (mapa[clave] === undefined && variantes.includes(n)) { mapa[clave] = col; break; }
      }
    });
    const tieneId = tipo === 'general' ? (mapa.codigo_barras !== undefined || mapa.lote !== undefined) : mapa.lote !== undefined;
    if (mapa.codigo !== undefined && mapa.peso !== undefined && tieneId) return { fila: i, mapa };
  }
  return null;
}

const texto = (v, largo) => {
  if (v == null) return null;
  const s = (v instanceof Date ? v.toISOString().slice(0, 10) : String(v)).replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, largo) : null;
};
const textoNumero = (v, largo) => {
  if (typeof v === 'number') return String(Number.isInteger(v) ? v : v).slice(0, largo);
  const s = texto(v, largo);
  return s ? s.replace(/\.0+$/, '') : null;
};

/** Fecha de Excel (Date), serial o texto dd/mm/aaaa → ISO; { error } si no se entiende. */
function fecha(v) {
  if (v == null || v === '') return null;
  const r = parsearFecha(v, 'dmy');
  return r;
}

/**
 * «Vencido» de la planta: es la fórmula =I2<TODAY() y ExcelJS devuelve su resultado guardado con el
 * formato de fecha de la celda (1899-12-30 = FALSO, 1899-12-31 = VERDADERO). null = no se sabe.
 */
function vencidoArchivo(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'boolean') return v;
  if (v instanceof Date) {
    const dias = Math.round((v.getTime() - Date.UTC(1899, 11, 30)) / 86400000);
    return dias === 0 ? false : dias === 1 ? true : null;
  }
  if (typeof v === 'number') return v !== 0;
  const n = norm(v);
  if (['si', 'true', 'verdadero', 'x', '1', 'vencido'].includes(n)) return true;
  if (['no', 'false', 'falso', '0'].includes(n)) return false;
  return null;
}

/** Peso: número > 0 (acepta «27,22» y «27.22»). */
function peso(v) {
  if (v == null || v === '') return { error: 'Sin peso' };
  const n = typeof v === 'number' ? v : Number(String(v).replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return { error: `Peso «${v}» no es un número` };
  if (n <= 0) return { error: `Peso ${n}: debe ser mayor que 0` };
  return { valor: r3(n) };
}

/**
 * Convierte las filas crudas de una hoja (arreglo de arreglos) en líneas tipadas. PURO.
 * @returns {{ lineas: object[], encabezado: boolean }}
 */
function leerFilas(filas, tipo, nombreHoja) {
  const enc = mapearEncabezado(filas, tipo);
  if (!enc) return { lineas: [], encabezado: false };
  const { mapa } = enc;
  const celda = (fila, clave) => (mapa[clave] === undefined ? null : fila[mapa[clave]]);
  const lineas = [];
  for (let i = enc.fila + 1; i < filas.length; i++) {
    const f = filas[i] || [];
    const cb = texto(celda(f, 'codigo_barras'), 60);
    const cod = textoNumero(celda(f, 'codigo'), 10);
    const desc = texto(celda(f, 'descripcion'), 150);
    const pesoCrudo = celda(f, 'peso');
    if (!cb && !cod && !desc && (pesoCrudo == null || pesoCrudo === '')) continue; // fila vacía
    const errores = [];
    const avisos = [];
    const p = peso(pesoCrudo);
    if (p.error) errores.push(p.error);

    let lote = textoNumero(celda(f, 'lote'), 20);
    // Excel guarda el lote como número y se come el 0 inicial: caja = 10 dígitos, primal = 8.
    if (lote && /^\d+$/.test(lote)) {
      if (tipo === 'maduracion' && lote.length < 8) lote = lote.padStart(8, '0');
      if (tipo === 'general' && lote.length === 9) lote = lote.padStart(10, '0');
    }
    const fv = fecha(celda(f, 'fecha_vencimiento'));
    if (fv && typeof fv === 'object') avisos.push(`Fecha de vencimiento: ${fv.error}`);
    const fd = fecha(celda(f, 'fecha_despacho'));
    if (fd && typeof fd === 'object') avisos.push(`Fecha de despacho: ${fd.error}`);
    const lineaNum = celda(f, 'linea');
    const sinCodigo = !cb || /^sin\s*cod/i.test(cb);
    lineas.push({
      hoja: tipo,
      hoja_nombre: nombreHoja,
      fila_hoja: i + 1,
      tarima: textoNumero(celda(f, 'tarima'), 20),
      linea: lineaNum != null && lineaNum !== '' && Number.isInteger(Number(lineaNum)) ? Number(lineaNum) : null,
      codigo_barras: tipo === 'general' && !sinCodigo ? cb.replace(/\s+/g, '').toUpperCase().slice(0, 40) : null,
      sin_codigo_barras: tipo === 'general' && sinCodigo,
      codigo: cod,
      descripcion: desc,
      caja: tipo === 'maduracion' ? textoNumero(celda(f, 'caja'), 20) : null,
      peso: p.error ? null : p.valor,
      medida: texto(celda(f, 'medida'), 20),
      lote,
      fecha_vencimiento: typeof fv === 'string' ? fv : null,
      vencido_archivo: vencidoArchivo(celda(f, 'vencido')),
      despacho: texto(celda(f, 'despacho'), 60),
      fecha_despacho: typeof fd === 'string' ? fd : null,
      pedido_por: texto(celda(f, 'pedido_por'), 80),
      orden: textoNumero(celda(f, 'orden'), 40),
      estatus: texto(celda(f, 'estatus'), 60),
      errores,
      avisos,
    });
  }
  return { lineas, encabezado: true };
}

/** Libro Excel → { hojas: [{ tipo, nombre, lineas, encabezado }], ignoradas: [nombres] }. PURO (sin base). */
async function leerLibro(buffer) {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(buffer);
  const hojas = [];
  const ignoradas = [];
  for (const hoja of libro.worksheets) {
    const tipo = tipoDeHoja(hoja.name);
    if (!tipo) { ignoradas.push(hoja.name.trim()); continue; }
    const filas = [];
    for (let r = 1; r <= hoja.rowCount; r++) {
      const fila = [];
      const row = hoja.getRow(r);
      for (let c = 1; c <= Math.max(hoja.columnCount, row.cellCount); c++) fila.push(valorCelda(row.getCell(c)));
      filas.push(fila);
    }
    hojas.push({ tipo, nombre: hoja.name.trim(), ...leerFilas(filas, tipo, hoja.name.trim()) });
  }
  return { hojas, ignoradas };
}

/**
 * Tabla pegada desde Excel (texto separado por tabuladores, con su fila de encabezados). La hoja se
 * reconoce por las columnas: con CAJA y sin código de barras = MADURACION; si no, INV GENERAL. PURO.
 */
function leerPegado(textoPegado) {
  const filas = String(textoPegado || '').split(/\r?\n/).filter((l) => l.trim()).map((l) => l.split('\t').map((c) => c.trim()));
  const general = mapearEncabezado(filas, 'general');
  const mad = mapearEncabezado(filas, 'maduracion');
  const esMad = mad && mad.mapa.caja !== undefined && !(general && general.mapa.codigo_barras !== undefined);
  const tipo = esMad ? 'maduracion' : 'general';
  const nombre = esMad ? 'MADURACION (pegado)' : 'INV GENERAL (pegado)';
  return { hojas: [{ tipo, nombre, ...leerFilas(filas, tipo, nombre) }], ignoradas: [] };
}

/** Lectura compacta para guardar en `decodificado` (sin el texto crudo repetido). */
function compacto(lectura) {
  const c = lectura.campos || {};
  const out = { tipo: lectura.tipo };
  for (const k of ['codigoProducto', 'producto', 'serie', 'pesoKg', 'fecha', 'fechaEmpaque', 'fechaVencimiento', 'loteDeshuese', 'loteLegible', 'campoXXX', 'box', 'sufijo', 'arete', 'genetica', 'marmoleo']) {
    if (c[k] !== undefined && c[k] !== null) out[k] = c[k];
  }
  if (lectura.errores && lectura.errores.length) out.errores = lectura.errores.map((e) => e.mensaje);
  return out;
}

/**
 * Lee el código de barras (hoja general) o el lote (maduración) y arma el puente de trazabilidad.
 * PURO. Devuelve { decodificado, puente (lectura para recuperarPorReporte) | null, sinArete, arete }.
 */
function evaluarEtiqueta(l) {
  if (l.hoja === 'maduracion') {
    if (!l.lote || !/^\d{8}$/.test(l.lote)) return { decodificado: null, puente: null, sinArete: false, motivo: 'Lote de maduración ilegible' };
    const f = interpretarFecha(l.lote.slice(0, 6), 'MMDDAA', 'fechaEmpaque');
    const loteDeshuese = Number(l.lote.slice(6));
    const decodificado = { tipo: 'lote_primal', loteLegible: l.lote, fechaEmpaque: f.fecha || null, loteDeshuese };
    if (!f.fecha) return { decodificado, puente: null, sinArete: false, motivo: `Lote ${l.lote}: la fecha MMDDAA no es válida`, avisos: [`Lote ${l.lote}: la fecha (MMDDAA) no es válida`] };
    return { decodificado, puente: { tipo: 'primal', campos: { fechaEmpaque: f.fecha, loteDeshuese } }, sinArete: false };
  }
  if (!l.codigo_barras) return { decodificado: null, puente: null, sinArete: false, motivo: 'Sin código de barras' };
  let d = decodificar(l.codigo_barras);
  if (d.tipo === 'ambigua') {
    // La planta trata el inventario como cajas (su columna Lote = posiciones 14–23 de la caja).
    const alts = d.alternativas || [];
    d = alts.find((a) => a.campos && a.campos.loteLegible === l.lote) || alts.find((a) => a.tipo === 'caja') || d;
  }
  const avisos = [];
  for (const e of d.errores || []) avisos.push(`Código de barras: ${e.mensaje}`);
  const c = d.campos || {};
  if (d.tipo === 'desconocida') return { decodificado: compacto(d), puente: null, sinArete: false, motivo: 'Código de barras ilegible', avisos };
  if (c.codigoProducto && l.codigo && c.codigoProducto !== l.codigo) avisos.push(`El código de barras dice producto ${c.codigoProducto} y la columna Código ${l.codigo}`);
  const esKilos = !l.medida || /^kil/i.test(l.medida);
  if (esKilos && c.pesoKg != null && l.peso != null && Math.abs(c.pesoKg - l.peso) > 0.011) avisos.push(`El código de barras dice ${c.pesoKg} kg y la columna Peso ${l.peso}`);
  if (d.tipo === 'caja' && l.lote && c.loteLegible && c.loteLegible !== l.lote) avisos.push(`El código de barras dice lote ${c.loteLegible} y la columna Lote ${l.lote}`);
  if (d.tipo === 'paquete') {
    const sinArete = c.trazabilidad === 'sin_trazabilidad';
    return { decodificado: compacto(d), puente: null, sinArete, arete: sinArete ? null : c.arete, motivo: sinArete ? `La etiqueta trae «${c.areteCrudo}» en lugar del arete` : null, avisos };
  }
  // Caja o primal: el animal no viaja en el código; se llega por fecha + lote de deshuese.
  const sinArete = d.tipo === 'caja' && esSinTrazabilidad(c.campoXXX);
  return { decodificado: compacto(d), puente: d, sinArete, avisos };
}

/** Clave de una línea para comparar snapshots: código de barras + lote (en maduración, caja + lote). */
function claveLinea(l) {
  if (l.hoja === 'maduracion') return `maduracion|${l.codigo || ''}|${l.lote || ''}|${l.caja || ''}`;
  return `general|${l.codigo_barras || `SIN:${l.codigo || ''}`}|${l.lote || ''}`;
}

/** Totales por hoja (piezas, kg, trazabilidad, vencidos). PURO: sirve al plan y a la consulta. */
function totalesDe(lineas) {
  const por = {};
  for (const l of lineas) {
    const t = por[l.hoja] || (por[l.hoja] = {
      piezas: 0, kg: 0, no_kg: {}, tarimas: new Set(),
      trazabilidad: { con_arete: 0, recuperada: 0, sin_trazabilidad: 0, na: 0 },
      vencidos: 0, kg_vencidos: 0,
    });
    t.piezas++;
    const esKilos = !l.medida || /^kil/i.test(l.medida);
    const p = Number(l.peso) || 0;
    if (esKilos) t.kg += p; else t.no_kg[l.medida] = r3((t.no_kg[l.medida] || 0) + p);
    if (l.tarima) t.tarimas.add(l.tarima);
    t.trazabilidad[l.trazabilidad || 'na']++;
    if (l.vencido) { t.vencidos++; if (esKilos) t.kg_vencidos += p; }
  }
  const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
  const salida = {};
  for (const [hoja, t] of Object.entries(por)) {
    const tr = t.trazabilidad;
    salida[hoja] = {
      piezas: t.piezas, kg: r2(t.kg), no_kg: t.no_kg, tarimas: t.tarimas.size,
      trazabilidad: tr,
      pct_con_trazabilidad: pct(tr.con_arete + tr.recuperada, t.piezas),
      pct_con_arete: pct(tr.con_arete, t.piezas),
      pct_recuperada: pct(tr.recuperada, t.piezas),
      pct_sin_trazabilidad: pct(tr.sin_trazabilidad, t.piezas),
      vencidos: t.vencidos, kg_vencidos: r2(t.kg_vencidos),
    };
  }
  return salida;
}

/** Hoy en Costa Rica (UTC-6, sin horario de verano) como AAAA-MM-DD. */
const hoyCR = () => new Date(Date.now() - 6 * 3600000).toISOString().slice(0, 10);

/** Altas y bajas entre dos multiconjuntos de claves: { clave → { n, muestra } }. */
function diferencia(actual, anterior) {
  const altas = []; const bajas = [];
  for (const [k, a] of actual) {
    const n = a.n - ((anterior.get(k) || {}).n || 0);
    if (n > 0) altas.push({ ...a.muestra, clave: k, cantidad: n });
  }
  for (const [k, b] of anterior) {
    const n = b.n - ((actual.get(k) || {}).n || 0);
    if (n > 0) bajas.push({ ...b.muestra, clave: k, cantidad: n });
  }
  return { altas, bajas };
}

function agrupar(lineas) {
  const m = new Map();
  for (const l of lineas) {
    const k = claveLinea(l);
    const g = m.get(k) || { n: 0, muestra: { hoja: l.hoja, codigo_barras: l.codigo_barras || null, codigo: l.codigo, descripcion: l.descripcion, lote: l.lote, caja: l.caja || null, tarima: l.tarima } };
    g.n++;
    m.set(k, g);
  }
  return m;
}

async function planificar(conn, _tabla, opciones = {}, { lectura }) {
  const erroresGenerales = [];
  let fechaInventario = null;
  if (opciones.fecha_inventario) {
    const f = parsearFecha(String(opciones.fecha_inventario), 'dmy');
    if (typeof f === 'string') fechaInventario = f; else erroresGenerales.push('La fecha del inventario no es válida');
  }
  const referencia = fechaInventario || hoyCR();

  // 1. Lectura pura de cada documento (archivo .xlsx y/o tabla pegada).
  const hojas = [];
  const ignoradas = [];
  for (const doc of lectura.documentos) {
    let r;
    if (doc.pegado) r = leerPegado(doc.texto);
    else {
      try { r = await leerLibro(doc.buffer); } catch (_) {
        erroresGenerales.push(`«${doc.nombre}»: no se pudo leer el Excel`);
        continue;
      }
    }
    hojas.push(...r.hojas);
    ignoradas.push(...r.ignoradas);
  }
  if (!hojas.length && !erroresGenerales.length) erroresGenerales.push('El archivo no trae las hojas «INV GENERAL» ni «MADURACION»');
  for (const h of hojas) if (!h.encabezado) erroresGenerales.push(`La hoja «${h.nombre}» no tiene la fila de encabezados esperada (Código, Peso, Lote…)`);
  const lineas = hojas.flatMap((h) => h.lineas);
  if (hojas.length && !lineas.length && !erroresGenerales.length) erroresGenerales.push('Las hojas no traen líneas de inventario');

  // 2. Etiqueta, vencimiento y catálogo.
  const codigos = [...new Set(lineas.map((l) => l.codigo).filter(Boolean))];
  let cat = [];
  if (codigos.length) [cat] = await conn.query(`SELECT codigo, activo FROM catalogo_cortes WHERE codigo IN (${marcas(codigos.length)})`, codigos);
  const enCatalogo = new Map(cat.map((c) => [String(c.codigo), Number(c.activo) === 1]));
  const fuera = new Map();
  for (const l of lineas) {
    const e = evaluarEtiqueta(l);
    l.decodificado = e.decodificado;
    l._puente = e.puente;
    l._sinArete = e.sinArete;
    l._arete = e.arete || null;
    l._motivo = e.motivo || null;
    l.avisos.push(...(e.avisos || []));
    if (l.sin_codigo_barras) l.avisos.push('La planta no puso código de barras: no se puede leer la etiqueta');
    l.vencido = l.vencido_archivo != null ? l.vencido_archivo : Boolean(l.fecha_vencimiento && l.fecha_vencimiento < referencia);
    if (l.codigo && !enCatalogo.has(l.codigo)) {
      l.avisos.push(`El código ${l.codigo} no está en el catálogo de cortes`);
      const f = fuera.get(l.codigo) || { codigo: l.codigo, descripcion: l.descripcion, lineas: 0 };
      f.lineas++;
      fuera.set(l.codigo, f);
    } else if (l.codigo && enCatalogo.get(l.codigo) === false) l.avisos.push(`El código ${l.codigo} está inactivo en el catálogo`);
  }

  // 3. Trazabilidad por el puente fecha + lote (una consulta por lote distinto, no por línea).
  const cache = new Map();
  for (const l of lineas) {
    if (!l._puente) {
      if (l._arete) { l.trazabilidad = 'con_arete'; l.arete = l._arete; l.traz_motivo = 'Arete impreso en la etiqueta'; } else if (l._sinArete) {
        l.trazabilidad = 'sin_trazabilidad'; l.traz_motivo = l._motivo;
        l.avisos.push(`Sin trazabilidad: ${l._motivo}`);
      } else { l.trazabilidad = 'na'; l.traz_motivo = l._motivo; }
      continue;
    }
    const c = l._puente.campos;
    const k = `${l._puente.tipo}|${c.fecha || c.fechaEmpaque}|${c.loteDeshuese}`;
    if (!cache.has(k)) cache.set(k, await recuperarPorReporte(conn, l._puente));
    const t = cache.get(k);
    if (t.estado === 'recuperada') {
      l.trazabilidad = l._sinArete ? 'recuperada' : 'con_arete';
      l.arete = t.arete; l.animal_id = t.animal_id; l.reporte_id = t.reporte_id;
      l.traz_motivo = t.motivo;
      if (l._sinArete) l.avisos.push(t.motivo);
    } else {
      l.trazabilidad = 'sin_trazabilidad';
      l.traz_motivo = t.motivo;
      if (l._sinArete) l.avisos.push(`Sin trazabilidad: la etiqueta trae «${l.decodificado && l.decodificado.campoXXX}» en lugar del animal. ${t.motivo}`);
    }
  }

  // 4. Snapshot ya cargado (mismo contenido) y comparación contra el último.
  const huellaContenido = sha256(JSON.stringify(lineas.map((l) => [l.hoja, l.fila_hoja, l.tarima, l.linea, l.codigo_barras,
    l.codigo, l.descripcion, l.caja, l.peso, l.medida, l.lote, l.fecha_vencimiento, l.vencido_archivo, l.despacho,
    l.fecha_despacho, l.pedido_por, l.orden, l.estatus])));
  const [[existente]] = await conn.query(
    "SELECT id, DATE_FORMAT(fecha_carga, '%Y-%m-%d %H:%i') AS fecha_carga FROM inventario_planta_cargas WHERE contenido_sha256 = ?", [huellaContenido]);
  const [[ultima]] = await conn.query(
    "SELECT id, DATE_FORMAT(fecha_carga, '%Y-%m-%d %H:%i') AS fecha_carga, DATE_FORMAT(fecha_inventario, '%Y-%m-%d') AS fecha_inventario FROM inventario_planta_cargas ORDER BY id DESC LIMIT 1");
  let comparacion = null;
  const validas = lineas.filter((l) => !l.errores.length);
  if (ultima && (!existente || existente.id !== ultima.id)) {
    const [prev] = await conn.query('SELECT hoja, codigo_barras, codigo, descripcion, lote, caja, tarima FROM inventario_planta_lineas WHERE carga_id = ?', [ultima.id]);
    const d = diferencia(agrupar(validas), agrupar(prev));
    comparacion = { carga_id: ultima.id, fecha_carga: ultima.fecha_carga, fecha_inventario: ultima.fecha_inventario,
      altas: d.altas.reduce((s, x) => s + x.cantidad, 0), bajas: d.bajas.reduce((s, x) => s + x.cantidad, 0) };
  }

  const filas = lineas.map((l, i) => {
    const accion = l.errores.length ? 'error' : existente ? 'sin_cambios' : 'nuevo';
    const { _puente, _sinArete, _arete, _motivo, vencido_archivo: _va, ...resto } = l; // eslint-disable-line no-unused-vars
    return { fila: i + 1, entidad: 'inventario_linea', accion, cambios: [], arete: null, animal_id: null, reporte_id: null, ...resto };
  });
  const totales = totalesDe(filas.filter((f) => f.accion !== 'error'));
  return {
    filas,
    errores_generales: erroresGenerales,
    hojas_leidas: hojas.map((h) => ({ tipo: h.tipo, nombre: h.nombre, lineas: h.lineas.length })),
    hojas_ignoradas: ignoradas,
    fecha_inventario: fechaInventario,
    vencido_referencia: referencia,
    totales,
    codigos_fuera_catalogo: [...fuera.values()],
    carga_existente: existente || null,
    comparacion_previa: comparacion,
    contenido: huellaContenido,
    resumen: { lineas_validas: validas.length },
  };
}

async function aplicar(conn, plan, { importacionId, usuarioId, registrar }) {
  if (plan.carga_existente) {
    registrar(null, 'inventario_planta_carga', plan.carga_existente.id, 'sin_cambios', { motivo: 'El mismo inventario ya estaba cargado' });
    return { resumen: { carga_id: plan.carga_existente.id, ya_cargado: true, lineas: 0 } };
  }
  const validas = plan.filas.filter((f) => f.accion === 'nuevo');
  let ins;
  try {
    [ins] = await conn.query(
      `INSERT INTO inventario_planta_cargas (fecha_inventario, archivo, contenido_sha256, quien, importacion_id, resumen)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [plan.fecha_inventario, plan.archivo_nombre, plan.contenido, usuarioId || null, importacionId,
        JSON.stringify({ totales: plan.totales, hojas: plan.hojas_leidas, fuera_catalogo: plan.codigos_fuera_catalogo.length, vencido_referencia: plan.vencido_referencia })]);
  } catch (e) {
    // Dos «aplicar» del mismo inventario a la vez: el otro ya guardó el snapshot (llave única del
    // contenido). No es un error para el usuario: el inventario quedó cargado una sola vez. En InnoDB
    // la llave duplicada revierte solo esta sentencia, así que la transacción sigue sana.
    if (!e || e.code !== 'ER_DUP_ENTRY') throw e;
    const [[otra]] = await conn.query('SELECT id FROM inventario_planta_cargas WHERE contenido_sha256 = ?', [plan.contenido]);
    if (!otra) throw e;
    registrar(null, 'inventario_planta_carga', otra.id, 'sin_cambios', { motivo: 'Otra carga simultánea guardó el mismo inventario' });
    return { resumen: { carga_id: otra.id, ya_cargado: true, lineas: 0 } };
  }
  const cargaId = ins.insertId;
  const filas = validas.map((f) => [cargaId, f.hoja, f.fila_hoja, f.tarima, f.linea, f.codigo_barras, f.codigo, f.descripcion, f.caja,
    f.peso, f.medida, f.lote, f.fecha_vencimiento, f.vencido ? 1 : 0, f.despacho, f.fecha_despacho, f.pedido_por, f.orden, f.estatus,
    f.decodificado ? JSON.stringify(f.decodificado) : null, f.trazabilidad, f.arete, f.animal_id, f.reporte_id]);
  for (let i = 0; i < filas.length; i += 500) {
    await conn.query(
      `INSERT INTO inventario_planta_lineas (carga_id, hoja, fila, tarima, linea, codigo_barras, codigo, descripcion, caja,
         peso, medida, lote, fecha_vencimiento, vencido, despacho, fecha_despacho, pedido_por, orden, estatus,
         decodificado, trazabilidad, arete, animal_id, reporte_id) VALUES ?`, [filas.slice(i, i + 500)]);
  }
  registrar(null, 'inventario_planta_carga', cargaId, 'creado', { lineas: filas.length, fecha_inventario: plan.fecha_inventario ? fechaTexto(plan.fecha_inventario) : null });
  return { resumen: { carga_id: cargaId, lineas: filas.length } };
}

module.exports = {
  planificar, aplicar,
  // Piezas puras (pruebas y la consulta del snapshot).
  leerLibro, leerPegado, leerFilas, evaluarEtiqueta, totalesDe, claveLinea, diferencia, agrupar, vencidoArchivo, tipoDeHoja,
};
