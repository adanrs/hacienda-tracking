/*
  Funciones PURAS de la carga por foto (sin navegador: se prueban con `node --test`).

  Un documento de varias páginas se fotografía página por página y cada foto se transcribe por
  separado. Al juntar los textos, el modelo suele repetir en cada página el título y la fila de
  encabezados de la tabla («Sacrificio Wagyu 15-10-26», «Cantidad · Número de canal…»): repetidos
  en medio de los datos, el lector del importador los tomaría como una fila de datos con error.
  Por eso, de la página 2 en adelante se quitan las líneas que repiten el ENCABEZADO de la página 1
  (todo lo que está antes de la primera fila de la tabla, incluida la fila de títulos).
  Si la página 1 no trae tabla por tabulador (el reporte de producción es texto corrido, y cada
  página es OTRO reporte con su propio encabezado) no se quita nada.
*/

const normalizar = (l) => String(l).replace(/\s+/g, ' ').trim().toLowerCase();

/** Líneas de encabezado de la primera página: hasta la primera línea con tabulador, inclusive. */
export function encabezadoDe(texto) {
  const lineas = String(texto || '').split(/\r?\n/).filter((l) => l.trim());
  const i = lineas.findIndex((l) => l.includes('\t'));
  return i < 0 ? [] : lineas.slice(0, i + 1);
}

/** Junta los textos de cada página (en orden) en uno solo, sin repetir el encabezado. */
export function unirPaginas(textos) {
  const validos = (textos || []).map((t) => String(t || '').trim()).filter(Boolean);
  if (validos.length <= 1) return validos[0] || '';
  const repetibles = new Set(encabezadoDe(validos[0]).map(normalizar));
  const resto = validos.slice(1).map((t) => t.split(/\r?\n/).filter((l) => !repetibles.has(normalizar(l))).join('\n').trim());
  return [validos[0], ...resto].filter(Boolean).join('\n');
}

/** Tamaño final de una foto para el servicio de lectura: el lado mayor a lo sumo `max` px. */
export function medidaReducida(ancho, alto, max = 1600) {
  const escala = Math.min(1, max / Math.max(ancho, alto));
  return { ancho: Math.max(1, Math.round(ancho * escala)), alto: Math.max(1, Math.round(alto * escala)) };
}

/** Texto de avance mientras se leen las páginas. */
export function textoAvance(actual, total, segundos) {
  const pagina = total > 1 ? `página ${actual} de ${total}` : 'la foto';
  return `Leyendo ${pagina}…${segundos >= 5 ? ` (${segundos} s)` : ''}`;
}
