// Vencimiento del producto: regla propia de Wagyu Cross (Juan Carlos, reunión 05-nov-2026).
//
// «Vencimiento = 1 año desde la fecha de producción, aunque esté congelado.» Pasada esa fecha la
// planta tiene que descartar el producto. No es una norma de CIISA ni de Hacienda: la fijó el
// dueño, por eso vive en una sola constante. Se cuenta en MESES de calendario (19/10/26 → 19/10/27),
// no en 365 días, porque así lo imprimen las etiquetas («consumir antes» = misma fecha un año después).
// Un 29 de febrero vence el 28 de febrero del año siguiente (no se corre a marzo).

const MESES_VENCIMIENTO = 12;
const RE_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Fecha AAAA-MM-DD + n meses de calendario (fin de mes ajustado). null si la fecha no es válida. */
function sumarMeses(fechaIso, meses) {
  const m = RE_ISO.exec(String(fechaIso || ''));
  if (!m) return null;
  const a = Number(m[1]); const mes = Number(m[2]); const d = Number(m[3]);
  const base = new Date(Date.UTC(a, mes - 1, d));
  if (base.getUTCMonth() !== mes - 1 || base.getUTCDate() !== d) return null;
  const totalMeses = (mes - 1) + meses;
  const anio = a + Math.floor(totalMeses / 12);
  const mesNuevo = ((totalMeses % 12) + 12) % 12;
  const ultimoDia = new Date(Date.UTC(anio, mesNuevo + 1, 0)).getUTCDate();
  const r = new Date(Date.UTC(anio, mesNuevo, Math.min(d, ultimoDia)));
  return r.toISOString().slice(0, 10);
}

/** Vencimiento según la regla del dueño: fecha de producción + 12 meses. */
function vencimientoDe(fechaProduccionIso) {
  return sumarMeses(fechaProduccionIso, MESES_VENCIMIENTO);
}

/**
 * Vencimiento a guardar cuando un archivo puede traer el suyo.
 * Regla: si el archivo trae FECHA VENCIMIENTO se RESPETA (es lo que dice la etiqueta física),
 * pero si no coincide con producción + 12 meses se avisa para que alguien lo revise.
 * @returns {{ fecha: string|null, calculada: string|null, origen: 'archivo'|'calculada'|null, aviso: string|null }}
 */
function resolverVencimiento(fechaProduccionIso, fechaArchivoIso) {
  const calculada = vencimientoDe(fechaProduccionIso);
  const archivo = RE_ISO.test(String(fechaArchivoIso || '')) ? fechaArchivoIso : null;
  if (archivo) {
    const aviso = calculada && archivo !== calculada
      ? `El archivo trae vencimiento ${archivo.split('-').reverse().join('/')}, distinto de producción + ${MESES_VENCIMIENTO} meses (${calculada.split('-').reverse().join('/')}): se respeta el del archivo`
      : null;
    return { fecha: archivo, calculada, origen: 'archivo', aviso };
  }
  return { fecha: calculada, calculada, origen: calculada ? 'calculada' : null, aviso: null };
}

module.exports = { MESES_VENCIMIENTO, sumarMeses, vencimientoDe, resolverVencimiento };
