// Lector genérico de tablas: recibe filas crudas (arreglo de arreglos, venga de Excel, CSV,
// HTML o texto pegado) y un formato de formatos.js, encuentra la fila de encabezado aunque haya
// títulos y leyendas encima, y devuelve cada fila de datos con sus valores ya tipados y los
// errores de lectura por celda. No decide nada de negocio (eso es del procesador).

const {
  normalizarEncabezado, normalizarArete, normalizarIE, parsearNumero, parsearFecha,
  ordenFechaColumna, vacio,
} = require('./texto');

const MAX_FILAS_BUSQUEDA_ENCABEZADO = 40;
const UNIDADES = /\s+(kg|kgs|lb|lbs|%)$/;

/**
 * ¿El texto de la celda corresponde a la variante? Exacto, sin la unidad final («peso pie kg»)
 * o truncado por el ancho de la columna («fec salid» es el inicio de «fec salida», mínimo 3
 * letras). NO se acepta que la variante sea el inicio de la celda: la leyenda de Ganadero SG
 * («Número = Número del Animal») no debe confundirse con el encabezado.
 * Devuelve un puntaje (3 exacto, 2 sin unidad, 1 truncado) o 0.
 */
function coincide(celda, variante) {
  if (!celda) return 0;
  if (celda === variante) return 3;
  const sinUnidad = celda.replace(UNIDADES, '');
  if (sinUnidad === variante || sinUnidad === variante.replace(UNIDADES, '')) return 2;
  if (celda.length >= 3 && variante.startsWith(celda)) return 1;
  return 0;
}

/** Mapa columna → índice para una fila candidata a encabezado. */
function mapearEncabezado(fila, formato) {
  const celdas = fila.map(normalizarEncabezado);
  const candidatos = [];
  celdas.forEach((celda, idx) => {
    for (const col of formato.columnas) {
      let mejor = 0;
      for (const v of col.encabezados) mejor = Math.max(mejor, coincide(celda, v));
      if (mejor) candidatos.push({ clave: col.clave, idx, puntaje: mejor });
    }
  });
  // Asignación codiciosa: primero las coincidencias exactas, cada columna y cada celda una vez.
  candidatos.sort((a, b) => b.puntaje - a.puntaje || a.idx - b.idx);
  const mapa = {};
  const usadas = new Set();
  for (const c of candidatos) {
    if (c.clave in mapa || usadas.has(c.idx)) continue;
    mapa[c.clave] = c.idx;
    usadas.add(c.idx);
  }
  return mapa;
}

/** Busca la fila de encabezado: la de más columnas reconocidas (mínimo `formato.minimoColumnas`). */
function detectarEncabezado(filas, formato) {
  let mejor = null;
  const limite = Math.min(filas.length, MAX_FILAS_BUSQUEDA_ENCABEZADO);
  for (let i = 0; i < limite; i++) {
    const fila = filas[i] || [];
    const mapa = mapearEncabezado(fila, formato);
    const n = Object.keys(mapa).length;
    if (n >= (formato.minimoColumnas || 3) && (!mejor || n > mejor.n)) mejor = { indice: i, mapa, n };
  }
  if (!mejor) return null;
  const faltantes = formato.columnas.filter(c => c.obligatoria && !(c.clave in mejor.mapa)).map(c => c.clave);
  return { indice: mejor.indice, mapa: mejor.mapa, faltantes };
}

/** Lee los metadatos (títulos de arriba) recorriendo cada celda de las filas antes del encabezado. */
function leerMetadatos(filas, formato, hasta, textosExtra = []) {
  const meta = {};
  const textos = [...textosExtra];
  for (let i = 0; i < hasta; i++) for (const c of filas[i] || []) if (!vacio(c)) textos.push(c instanceof Date ? c : String(c));
  for (const def of formato.metadatos || []) {
    for (const t of textos) {
      if (def.tipo === 'fecha' && t instanceof Date) continue;
      const m = String(t).match(def.patron);
      if (!m) continue;
      if (def.tipo === 'fecha') {
        const f = parsearFecha(m[1], def.orden || 'dmy');
        if (f && typeof f === 'string') { meta[def.clave] = f; break; }
      } else { meta[def.clave] = m[1].trim(); break; }
    }
  }
  return meta;
}

function tiparValor(col, crudo, ctx) {
  if (vacio(crudo)) return { valor: null };
  switch (col.tipo) {
    case 'arete': return { valor: normalizarArete(crudo) || null };
    case 'ie': return { valor: normalizarIE(crudo) || null };
    case 'sexo': {
      const s = normalizarEncabezado(crudo);
      if (['m', 'macho'].includes(s)) return { valor: 'macho' };
      if (['h', 'f', 'hembra'].includes(s)) return { valor: 'hembra' };
      return { valor: null, error: `sexo «${crudo}» desconocido (use M o H)` };
    }
    case 'numero':
    case 'entero': {
      const n = parsearNumero(crudo, { comaDecimal: ctx.comaDecimal });
      if (n == null) return { valor: null };
      if (Number.isNaN(n)) return { valor: null, error: `«${crudo}» no es un número` };
      if (col.tipo === 'entero' && !Number.isInteger(n)) return { valor: null, error: `«${crudo}» debe ser un número entero` };
      return { valor: n };
    }
    case 'fecha': {
      const f = parsearFecha(crudo, ctx.ordenes[col.clave]);
      if (f && typeof f === 'object') return { valor: null, error: f.error };
      return { valor: f };
    }
    default: {
      const t = crudo instanceof Date ? crudo.toISOString().slice(0, 10) : String(crudo).trim();
      return { valor: t === '' ? null : t };
    }
  }
}

/**
 * Filas crudas → { encabezado, filas: [{ fila, valores, errores }], metadatos }.
 * `fila` es el número de fila tal como lo ve el usuario en Excel (base 1).
 * Las filas totalmente vacías o sin ninguna columna obligatoria se saltan (pies de reporte, totales).
 */
function leerTabla(filas, formato, { comaDecimal = false, textosExtra = [] } = {}) {
  let enc = detectarEncabezado(filas, formato);
  let inicio;
  let mapa;
  if (enc) {
    inicio = enc.indice + 1;
    mapa = enc.mapa;
  } else if (formato.posicional) {
    // Sin encabezado reconocible (texto pegado que partió el encabezado en varias líneas): se
    // aceptan las filas que traen exactamente las columnas del formato, en orden.
    mapa = Object.fromEntries(formato.posicional.map((c, i) => [c, i]));
    inicio = 0;
    enc = { indice: -1, mapa, faltantes: [], posicional: true };
  } else {
    return { encabezado: null, filas: [], metadatos: leerMetadatos(filas, formato, filas.length, textosExtra) };
  }

  const columnas = formato.columnas.filter(c => c.clave in mapa);
  const obligatorias = formato.columnas.filter(c => c.obligatoria && c.clave in mapa);

  const candidatas = [];
  for (let i = inicio; i < filas.length; i++) {
    const fila = filas[i] || [];
    // Una fila con una sola celda es un título, una nota o un pie («Total animales: 11»), no un dato.
    if (fila.filter(c => !vacio(c)).length < 2) continue;
    if (enc.posicional && fila.filter(c => !vacio(c)).length !== formato.posicional.length) continue;
    const crudos = {};
    for (const col of columnas) crudos[col.clave] = fila[mapa[col.clave]];
    // Una fila sin ninguna de las columnas obligatorias es un pie («Total…») o una nota: no es dato.
    if (obligatorias.length && obligatorias.every(c => vacio(crudos[c.clave]))) {
      // …salvo que traiga otros datos: entonces es una fila con la llave vacía (error visible).
      const otros = columnas.filter(c => !c.obligatoria && !vacio(crudos[c.clave])).length;
      if (otros < 3) continue;
    }
    candidatas.push({ fila: i + 1, crudos });
  }

  // El orden día/mes se decide por columna con todos sus valores (ver ordenFechaColumna).
  const ordenes = {};
  for (const col of columnas.filter(c => c.tipo === 'fecha')) {
    ordenes[col.clave] = ordenFechaColumna(candidatas.map(c => c.crudos[col.clave]), formato.ordenFechas || 'dmy');
  }
  const ctx = { comaDecimal, ordenes };

  const salida = candidatas.map(({ fila, crudos }) => {
    const valores = {};
    const errores = [];
    for (const col of columnas) {
      const r = tiparValor(col, crudos[col.clave], ctx);
      valores[col.clave] = r.valor;
      if (r.error) errores.push(`${col.clave}: ${r.error}`);
    }
    return { fila, valores, errores, crudos };
  });

  return {
    encabezado: { fila: enc.indice + 1, columnas: Object.keys(mapa), faltantes: enc.faltantes, posicional: !!enc.posicional, ordenesFecha: ordenes },
    filas: salida,
    // Con encabezado, los títulos están arriba; en modo posicional el asunto puede venir en cualquier línea.
    metadatos: leerMetadatos(filas, formato, enc.posicional ? filas.length : enc.indice, textosExtra),
  };
}

/** Prueba cada hoja y devuelve la primera donde aparezca el encabezado del formato. */
function leerHojas(hojas, formato, opciones = {}) {
  let primera = null;
  for (const h of hojas) {
    const r = leerTabla(h.filas, formato, { ...opciones, comaDecimal: opciones.comaDecimal || h.comaDecimal });
    if (!primera) primera = { ...r, hoja: h.nombre };
    if (r.encabezado && r.filas.length) return { ...r, hoja: h.nombre };
  }
  return primera || { encabezado: null, filas: [], metadatos: {} };
}

module.exports = { leerTabla, leerHojas, detectarEncabezado, mapearEncabezado, coincide };
