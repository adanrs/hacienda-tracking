/**
 * Decodificador puro de las etiquetas que imprime CIISA «El Arreo»
 * (Sistema de Trazabilidad v10, 8-oct-2026, §4.2 D y §11.3).
 *
 * Sin dependencias ni acceso a base de datos: recibe el texto leído por el escáner
 * y devuelve los campos interpretados. Tres estructuras conocidas:
 *
 *  A · Paquete (28 caracteres, alfanumérico)
 *      1–6   arete (6 caracteres, puede traer guion: «0103-M», «34GKAE»; relleno con 0: «0PG087»)
 *      7–11  código de producto (5 dígitos)
 *      12–17 fecha de producción DDMMAA (porcionado o reempaque)
 *      18–19 lote de deshuese (2 dígitos)
 *      20–24 peso de la pieza en gramos (5 dígitos)
 *      25–26 contenido genético (F1 | FB)
 *      27–28 marmoleo DMs AUSMEAT (01–12)
 *
 *  B · Caja / fondo (25 caracteres)
 *      1–5   código de producto
 *      6–10  peso neto en centésimas de kg
 *      11–13 campo «XXX» (significado por confirmar con CIISA; se guarda crudo)
 *      14–19 fecha DDMMAA (base del vencimiento)
 *      20–23 lote de deshuese (4 dígitos)
 *      24–25 sufijo (por confirmar; se guarda crudo)
 *      Texto legible «Lote 2201250031» = posiciones 14–23.
 *
 *  C · Primal (25 dígitos, Code 39)
 *      1–5   código Arreo del primal
 *      6–10  Box (id único de la caja)
 *      11–15 peso neto en centésimas de kg
 *      16–21 fecha de empaque MMDDAA (¡mes primero!)
 *      22–23 lote de deshuese (2 dígitos)
 *      24–25 sufijo (se guarda crudo)
 *      Texto legible «Lot 03112620» = posiciones 16–23.
 *
 * Desambiguación por estructura (antes de interpretar nada):
 *   28 caracteres → paquete.
 *   25 caracteres con algún carácter no numérico → caja (el «XXX» real son letras).
 *   25 caracteres todos dígitos → primal.
 *
 *   OJO: una caja cuyo campo «XXX» viniera numérico sería indistinguible de un primal
 *   por estructura. Se devuelve `tipo: 'ambigua'` con ambas lecturas en `alternativas` cuando:
 *     - el código de producto (pos. 1–5) es de una serie de producto terminado
 *       (F1 / FB / PVA), que no corresponde a un primal (los primales usan código Arreo), o
 *     - la lectura como primal tiene errores y la lectura como caja no.
 *
 * Validado con 4 etiquetas reales fotografiadas el 12-oct-2026 (detalle en
 * docs/etiquetas-ciisa/etiquetas-reales-2026-10-12.md) y con las reglas que dio el cliente ese día:
 *   - El lote de 2 dígitos (4 en la caja, con «00» delante) es el n.º de deshuese = la POSICIÓN
 *     del animal en el deshuese de ese día. El arete se resuelve con la tabla posición → arete
 *     del Reporte Diario de Producción; el mismo número en dos etiquetas no implica el mismo animal
 *     si la fecha de deshuese es otra.
 *   - Caja y primal llevan la FECHA DEL DESHUESE en el lote (caja DDMMAA, primal MMDDAA), por eso
 *     exponen `fechaDeshuese`. El paquete NO: su fecha es la de producción/empaque (el «Consumir
 *     antes» es esa fecha + 1 año) y la del deshuese solo viene en el texto legible del lote
 *     («Lote: PG087 22112407» = arete + 22/11/24 + deshuese 07, un día antes que el código de barras).
 *     Por eso el paquete devuelve `fechaDeshuese: null` en vez de reutilizar su fecha.
 *   - El arete de 5 caracteres (p. ej. «PG087», «72ELF») se rellena con «0» a la izquierda para
 *     ocupar las 6 posiciones del paquete («0PG087»). Se devuelve `areteSinRelleno` como lectura
 *     alternativa, con advertencia; no se corrige porque un arete real también puede empezar en 0.
 */

const { CATALOGO_POR_CODIGO } = require('../data/catalogo-ciisa');

const LARGO_PAQUETE = 28;
const LARGO_CAJA_PRIMAL = 25;

// FB con código fuera de la serie 263xx (anexo C1). También están en el catálogo;
// se repiten aquí para que la regla sea explícita aunque el catálogo cambie.
const FB_FUERA_DE_SERIE = new Set(['26676', '26680', '26684']);

// ── Utilidades ──────────────────────────────────────────────────────────────

function error(codigo, campo, mensaje) {
  return { codigo, campo, mensaje };
}

/** Quita espacios y saltos de línea (conserva guiones) y pasa a mayúsculas. */
function normalizar(codigoCrudo) {
  return String(codigoCrudo == null ? '' : codigoCrudo).replace(/\s+/g, '').toUpperCase();
}

const esDigitos = (s) => /^\d+$/.test(s);

/** Toma posiciones 1-indexadas inclusivas, como en el documento de requisitos. */
const pos = (s, desde, hasta) => s.slice(desde - 1, hasta);

/**
 * Interpreta una fecha de 6 dígitos.
 * @param {string} texto  6 dígitos
 * @param {'DDMMAA'|'MMDDAA'} formato
 * @returns {{ fecha: string|null, fechaAmbigua: boolean, error: object|null }}
 *   fechaAmbigua = true cuando el día ≤ 12 (y distinto del mes): la misma cifra se puede leer
 *   como DDMMAA o MMDDAA y exige validación cruzada contra la fecha registrada del lote (§4.2 D).
 */
function interpretarFecha(texto, formato, campo = 'fecha') {
  if (!/^\d{6}$/.test(texto)) {
    return { fecha: null, fechaAmbigua: false, error: error('fecha_invalida', campo, `Fecha «${texto}» no es de 6 dígitos (${formato})`) };
  }
  const a = Number(texto.slice(0, 2));
  const b = Number(texto.slice(2, 4));
  const anio = 2000 + Number(texto.slice(4, 6));
  const [dia, mes] = formato === 'DDMMAA' ? [a, b] : [b, a];

  const d = new Date(Date.UTC(anio, mes - 1, dia));
  const valida = mes >= 1 && mes <= 12 && dia >= 1
    && d.getUTCFullYear() === anio && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
  if (!valida) {
    return { fecha: null, fechaAmbigua: false, error: error('fecha_imposible', campo, `Fecha «${texto}» imposible como ${formato}`) };
  }
  const iso = `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
  return { fecha: iso, fechaAmbigua: dia <= 12 && dia !== mes, error: null };
}

function pesoDesde(texto, divisor, decimales, campo) {
  if (!/^\d{5}$/.test(texto)) {
    return { pesoKg: null, error: error('peso_invalido', campo, `Peso «${texto}» no es de 5 dígitos`) };
  }
  return { pesoKg: Number((Number(texto) / divisor).toFixed(decimales)), error: null };
}

function loteDesde(texto, largo) {
  if (!new RegExp(`^\\d{${largo}}$`).test(texto)) {
    return { loteDeshuese: null, loteTexto: texto, error: error('lote_invalido', 'loteDeshuese', `Lote «${texto}» no es de ${largo} dígitos`) };
  }
  return { loteDeshuese: Number(texto), loteTexto: texto, error: null };
}

function codigoProductoDesde(texto) {
  if (!/^\d{5}$/.test(texto)) {
    return error('codigo_producto_invalido', 'codigoProducto', `Código de producto «${texto}» no es de 5 dígitos`);
  }
  return null;
}

// ── API pública: arete y serie ──────────────────────────────────────────────

/**
 * Valida un arete: 6 caracteres alfanuméricos, con a lo sumo un guion intermedio
 * (el guion cuenta dentro de los 6: «0103-M»).
 * @returns {{ valido: boolean, arete: string, error: object|null }}
 */
function validarArete(texto) {
  const arete = normalizar(texto);
  const valido = /^[A-Z0-9-]{6}$/.test(arete)
    && (arete.match(/-/g) || []).length <= 1
    && !arete.startsWith('-') && !arete.endsWith('-');
  return {
    valido,
    arete,
    error: valido ? null : error('arete_invalido', 'arete', `Arete «${arete}» no tiene formato válido (6 caracteres alfanuméricos, guion opcional)`),
  };
}

/**
 * Normaliza un arete y detecta el caso conocido de arete invertido (DJF526 vs 526DJF).
 * NO corrige: solo devuelve la lectura alternativa y una advertencia para que el
 * operador o la validación contra el registro del animal decidan.
 * @returns {{ arete: string, valido: boolean, alternativaInvertida: string|null, advertencias: object[] }}
 */
function normalizarArete(texto) {
  const { arete, valido } = validarArete(texto);
  const advertencias = [];
  let alternativaInvertida = null;
  const m = arete.match(/^([A-Z]+)(\d+)$/) || arete.match(/^(\d+)([A-Z]+)$/);
  if (m) {
    alternativaInvertida = m[2] + m[1];
    advertencias.push(error('arete_posiblemente_invertido', 'arete',
      `Si «${arete}» no existe en el registro, verificar «${alternativaInvertida}» (caso conocido de arete invertido)`));
  }
  return { arete, valido, alternativaInvertida, advertencias };
}

/**
 * Serie de un código de producto según el catálogo CIISA (anexos C1–C4).
 * 'F1' (266xx), 'FB' (263xx o FB fuera de serie 26676/26680/26684), 'PVA' (procesados),
 * 'ARREO' (códigos de planta) o null si no se reconoce.
 * El catálogo manda sobre el prefijo (p. ej. 26344 es PVA aunque empiece por 263).
 */
function serieDeCodigo(codigo) {
  const c = String(codigo == null ? '' : codigo).trim();
  const entrada = CATALOGO_POR_CODIGO[c];
  if (entrada) return entrada.serie;
  if (FB_FUERA_DE_SERIE.has(c)) return 'FB';
  if (!/^\d{5}$/.test(c)) return null;
  if (c.startsWith('266')) return 'F1';
  if (c.startsWith('263')) return 'FB';
  return null;
}

function datosProducto(codigo) {
  const entrada = CATALOGO_POR_CODIGO[codigo];
  return {
    codigoProducto: codigo,
    serie: serieDeCodigo(codigo),
    producto: entrada ? entrada.nombre : null,
  };
}

// ── Lectores por tipo (asumen el largo ya verificado) ───────────────────────

function leerPaquete(s) {
  const errores = [];
  const advertencias = [];

  const areteTxt = pos(s, 1, 6);
  const { valido: areteValido, error: errArete } = validarArete(areteTxt);
  if (!areteValido) errores.push(errArete);

  const codigo = pos(s, 7, 11);
  const errCodigo = codigoProductoDesde(codigo);
  if (errCodigo) errores.push(errCodigo);

  const f = interpretarFecha(pos(s, 12, 17), 'DDMMAA', 'fechaProduccion');
  if (f.error) errores.push(f.error);

  const lote = loteDesde(pos(s, 18, 19), 2);
  if (lote.error) errores.push(lote.error);

  const pesoTxt = pos(s, 20, 24);
  const peso = pesoDesde(pesoTxt, 1000, 3, 'pesoKg');
  if (peso.error) errores.push(peso.error);

  const genetica = pos(s, 25, 26);
  if (genetica !== 'F1' && genetica !== 'FB') {
    errores.push(error('genetica_invalida', 'genetica', `Contenido genético «${genetica}» no es F1 ni FB`));
  }

  const marmoleoTxt = pos(s, 27, 28);
  const marmoleo = esDigitos(marmoleoTxt) ? Number(marmoleoTxt) : null;
  if (marmoleo === null || marmoleo < 1 || marmoleo > 12) {
    errores.push(error('marmoleo_invalido', 'marmoleo', `Marmoleo «${marmoleoTxt}» fuera de rango DMs AUSMEAT 01–12`));
  }

  const producto = datosProducto(codigo);

  // Validación cruzada serie ↔ genética (§11.3: Denver 26632 y Picanha 26606 salieron con
  // código F1 en lotes de animales FB). Solo aplica a series F1/FB.
  if ((producto.serie === 'F1' || producto.serie === 'FB')
      && (genetica === 'F1' || genetica === 'FB') && producto.serie !== genetica) {
    errores.push(error('genetica_cruzada', 'genetica',
      `El código ${codigo} es serie ${producto.serie} pero la etiqueta dice ${genetica}`));
  }

  if (f.fechaAmbigua) {
    advertencias.push(error('fecha_ambigua', 'fechaProduccion',
      'Día ≤ 12: la fecha podría leerse como DDMMAA o MMDDAA; validar contra la fecha registrada del lote'));
  }

  // Etiqueta real «0PG087…» con lote legible «PG087»: el campo de 6 posiciones rellena con ceros
  // a la izquierda los aretes más cortos. Si el registro no tiene el arete tal cual, hay que buscar
  // la lectura sin relleno (mismo criterio que el arete invertido: se avisa, no se corrige).
  const areteSinRelleno = areteValido ? (areteTxt.replace(/^0+/, '') || areteTxt) : null;
  if (areteSinRelleno && areteSinRelleno !== areteTxt) {
    advertencias.push(error('arete_con_relleno', 'arete',
      `Si «${areteTxt}» no existe en el registro, verificar «${areteSinRelleno}» (el código rellena con 0 los aretes de menos de 6 caracteres)`));
  }

  return {
    tipo: 'paquete',
    campos: {
      arete: areteTxt,
      areteSinRelleno,
      ...producto,
      fechaProduccion: f.fecha,
      fecha: f.fecha,
      // La fecha del deshuese no está en el código de barras del paquete (ver cabecera).
      fechaDeshuese: null,
      fechaAmbigua: f.fechaAmbigua,
      loteDeshuese: lote.loteDeshuese,
      loteTexto: lote.loteTexto,
      pesoGramos: peso.error ? null : Number(pesoTxt),
      pesoKg: peso.pesoKg,
      genetica,
      marmoleo,
    },
    errores,
    advertencias,
  };
}

function leerCaja(s) {
  const errores = [];
  const advertencias = [];

  const codigo = pos(s, 1, 5);
  const errCodigo = codigoProductoDesde(codigo);
  if (errCodigo) errores.push(errCodigo);

  const peso = pesoDesde(pos(s, 6, 10), 100, 2, 'pesoKg');
  if (peso.error) errores.push(peso.error);

  const f = interpretarFecha(pos(s, 14, 19), 'DDMMAA', 'fecha');
  if (f.error) errores.push(f.error);

  const lote = loteDesde(pos(s, 20, 23), 4);
  if (lote.error) errores.push(lote.error);

  if (f.fechaAmbigua) {
    advertencias.push(error('fecha_ambigua', 'fecha',
      'Día ≤ 12: la fecha podría leerse como DDMMAA o MMDDAA; validar contra la fecha registrada del lote'));
  }

  return {
    tipo: 'caja',
    campos: {
      ...datosProducto(codigo),
      pesoKg: peso.pesoKg,
      campoXXX: pos(s, 11, 13), // significado por confirmar con CIISA: no se valida
      fecha: f.fecha,
      // Regla del cliente (12-oct): el lote de la caja master es fecha del deshuese + 00 + n.º de deshuese.
      fechaDeshuese: f.fecha,
      fechaAmbigua: f.fechaAmbigua,
      loteDeshuese: lote.loteDeshuese,
      loteTexto: lote.loteTexto,
      loteLegible: pos(s, 14, 23),
      sufijo: pos(s, 24, 25), // por confirmar con CIISA
    },
    errores,
    advertencias,
  };
}

function leerPrimal(s) {
  const errores = [];
  const advertencias = [];

  if (!esDigitos(s)) {
    errores.push(error('primal_no_numerico', 'crudo', 'La etiqueta de primal debe ser 25 dígitos'));
  }

  const codigo = pos(s, 1, 5);
  const errCodigo = codigoProductoDesde(codigo);
  if (errCodigo) errores.push(errCodigo);

  const box = pos(s, 6, 10);
  if (!/^\d{5}$/.test(box)) errores.push(error('box_invalido', 'box', `Box «${box}» no es de 5 dígitos`));

  const peso = pesoDesde(pos(s, 11, 15), 100, 2, 'pesoKg');
  if (peso.error) errores.push(peso.error);

  const f = interpretarFecha(pos(s, 16, 21), 'MMDDAA', 'fechaEmpaque');
  if (f.error) errores.push(f.error);

  const lote = loteDesde(pos(s, 22, 23), 2);
  if (lote.error) errores.push(lote.error);

  if (f.fechaAmbigua) {
    advertencias.push(error('fecha_ambigua', 'fechaEmpaque',
      'Día ≤ 12: la fecha podría leerse como MMDDAA o DDMMAA; validar contra la fecha registrada del lote'));
  }

  return {
    tipo: 'primal',
    campos: {
      ...datosProducto(codigo),
      box,
      pesoKg: peso.pesoKg,
      fechaEmpaque: f.fecha,
      fecha: f.fecha,
      // La caja de deshuese se empaca el mismo día del deshuese (real: «Lot 12072324» = DEC-07-2023).
      fechaDeshuese: f.fecha,
      fechaAmbigua: f.fechaAmbigua,
      loteDeshuese: lote.loteDeshuese,
      loteTexto: lote.loteTexto,
      loteLegible: pos(s, 16, 23),
      sufijo: pos(s, 24, 25),
    },
    errores,
    advertencias,
  };
}

// ── Punto de entrada ────────────────────────────────────────────────────────

/**
 * Decodifica el texto crudo de una etiqueta CIISA.
 * @param {string} codigoCrudo  lo que entregó el escáner (puede traer espacios o saltos)
 * @returns {{ tipo: 'paquete'|'caja'|'primal'|'ambigua'|'desconocida', campos: object,
 *             errores: object[], advertencias: object[], crudo: string, normalizado: string,
 *             alternativas?: object[] }}
 *   Cada error/advertencia es { codigo, campo, mensaje }.
 */
function decodificar(codigoCrudo) {
  const crudo = codigoCrudo == null ? '' : String(codigoCrudo);
  const s = normalizar(crudo);
  const envolver = (r) => ({ ...r, crudo, normalizado: s });

  if (s.length === LARGO_PAQUETE) {
    return envolver(leerPaquete(s));
  }

  if (s.length === LARGO_CAJA_PRIMAL) {
    if (!esDigitos(s)) return envolver(leerCaja(s));

    // 25 dígitos: por estructura es primal, salvo los casos ambiguos documentados arriba.
    const primal = leerPrimal(s);
    const caja = leerCaja(s);
    const serie = serieDeCodigo(pos(s, 1, 5));
    const codigoDeProductoTerminado = serie === 'F1' || serie === 'FB' || serie === 'PVA';
    const primalFalla = primal.errores.length > 0 && caja.errores.length === 0;

    if (codigoDeProductoTerminado || primalFalla) {
      return envolver({
        tipo: 'ambigua',
        campos: {},
        errores: [error('tipo_ambiguo', 'tipo',
          '25 dígitos: puede ser una caja con campo «XXX» numérico o un primal; confirmar con el operador')],
        advertencias: [],
        alternativas: [
          { ...caja, crudo, normalizado: s },
          { ...primal, crudo, normalizado: s },
        ],
      });
    }
    return envolver(primal);
  }

  return envolver({
    tipo: 'desconocida',
    campos: {},
    errores: [error('largo_invalido', 'crudo',
      `Largo ${s.length}: se esperaban ${LARGO_PAQUETE} (paquete) o ${LARGO_CAJA_PRIMAL} (caja / primal) caracteres`)],
    advertencias: [],
  });
}

module.exports = {
  decodificar,
  validarArete,
  normalizarArete,
  serieDeCodigo,
  interpretarFecha,
  normalizar,
};
