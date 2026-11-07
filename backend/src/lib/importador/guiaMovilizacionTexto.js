// Lector del texto de la GUÍA DE MOVILIZACIÓN del MAG/SENASA (formulario de trazabilidad FTZ-02):
// número de guía, fecha, origen → destino y la lista de bovinos con su DIIO (dispositivo oficial).
//
// El texto llega de tres lados y cada uno lo arma distinto:
//   - pdf-parse (PDF del sistema del SENASA): pega columnas de una misma línea sin espacio
//     («HCruza Brahman», «1880501049214501-024426», «Alfredo Ramírez Carranza203130292…»).
//   - Word (.docx): las celdas de tabla vienen por tabulador.
//   - Lectura por foto (vision.js): líneas con etiqueta «Fecha: …» y la tabla por tabulador.
// Por eso se buscan las etiquetas del formulario y el valor en la misma línea o en la siguiente, y
// los DIIO solo DESPUÉS del título de la tabla de animales (el CUE del establecimiento también es
// un número de 13 dígitos que empieza por 188 y no es un animal).
//
// Puro: no toca la base. Ver procesadores/guiaMovilizacion.js.

const MESES = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, set: 9, sep: 9, sept: 9, oct: 10, nov: 11, dic: 12 };
const pad = (n) => String(n).padStart(2, '0');

/** «15/oct./2026», «15/10/2026», «15-10-26» → '2026-10-15' (o null si no es una fecha real). */
function fechaGuia(texto) {
  const m = String(texto || '').match(/(\d{1,2})\s*[/.-]\s*([a-záéíóú]{3,5}\.?|\d{1,2})\s*[/.-]\s*(\d{2,4})/i);
  if (!m) return null;
  const dia = Number(m[1]);
  const mesTxt = m[2].toLowerCase().replace('.', '');
  const mes = /^\d+$/.test(mesTxt) ? Number(mesTxt) : MESES[mesTxt.normalize('NFD').replace(/[̀-ͯ]/g, '')];
  let anio = Number(m[3]);
  if (anio < 100) anio += 2000;
  if (!mes || mes > 12 || dia < 1 || dia > 31) return null;
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  if (d.getUTCMonth() !== mes - 1) return null;
  return `${anio}-${pad(mes)}-${pad(dia)}`;
}

/** «07:20 a. m.» → '07:20'; «2:05 p.m.» → '14:05'; «14:03» → '14:03'. */
function horaGuia(texto) {
  const m = String(texto || '').match(/(\d{1,2}):(\d{2})(?:\s*([ap])\.?\s*m\.?)?/i);
  if (!m) return null;
  let h = Number(m[1]);
  const ap = (m[3] || '').toLowerCase();
  if (ap === 'p' && h < 12) h += 12;
  if (ap === 'a' && h === 12) h = 0;
  return h < 24 ? `${pad(h)}:${m[2]}` : null;
}

// Etiquetas del formulario que pueden quedar en la línea siguiente a otra etiqueta (columnas del
// PDF partidas en líneas): nunca son el valor.
const ES_ETIQUETA = /^(c[oó]digo alterno|c[eé]dula(\s+del\s+(transportista|conductor))?|cue\s+(origen|destino)|n[uú]mero de cvo|placa del veh[ií]culo|descripci[oó]n del veh[ií]culo|tel[eé]fono|provincia|cant[oó]n|distrito|comunidad)\b/i;

/**
 * Valor de una etiqueta: lo que sigue en la misma línea si la etiqueta es «Algo:» (lectura por foto),
 * si no, la siguiente línea que no sea otra etiqueta.
 */
function valorDe(lineas, etiquetas) {
  for (const re of etiquetas) {
    const i = lineas.findIndex((l) => re.test(l));
    if (i < 0) continue;
    const m = lineas[i].match(re);
    const resto = lineas[i].slice(m.index + m[0].length).replace(/^[\s:.\-–]+/, '').trim();
    if (/:\s*$/.test(m[0]) || /:/.test(lineas[i].slice(m.index + m[0].length, m.index + m[0].length + 3))) {
      if (resto) return resto;
    }
    for (let j = i + 1; j < Math.min(lineas.length, i + 5); j++) {
      const l = lineas[j].trim();
      if (!l || ES_ETIQUETA.test(l)) continue;
      return l;
    }
  }
  return null;
}

/** Nombre al inicio de una línea donde el PDF pegó la cédula y otros números detrás. */
const soloNombre = (v) => (v ? v.replace(/\s*\d{6,}.*$/, '').replace(/\s+/g, ' ').trim() || null : null);

/**
 * Sexo y raza como vienen en la tabla: «H», «M», «MC» (macho castrado), a veces pegados a la raza
 * («HCruza Brahman», «MCCruza Wagyu»). «MCruza» es M + «Cruza» (la raza empieza con mayúscula).
 */
function sexoRaza(texto) {
  const t = String(texto || '').trim();
  let m = t.match(/^(MC|M|H)(?=$|[\s\t])\s*(.*)$/);
  if (m) return { sexo: m[1], raza: m[2].trim() || null };
  m = t.match(/^MC([A-ZÁÉÍÓÚÑ].*)$/);
  if (m) return { sexo: 'MC', raza: m[1].trim() };
  m = t.match(/^(M|H)([A-ZÁÉÍÓÚÑ].*)$/);
  if (m) return { sexo: m[1], raza: m[2].trim() };
  return null;
}

const RE_DIIO = /(?<!\d)(\d{12,15})(?!\d)/;
const MARCA = /^[üÜ✓✔√xX*]$/;
const FIN_TABLA = /^(comentarios|fierro\s*\/\s*marca|declaraci[oó]n de cambio)/i;

/**
 * Texto de la guía → { numero, fecha, hora, autorizacion, origen, destino, transportista, placa,
 * conductor, total_bovinos, animales: [{ orden, diio, sexo, raza }], avisos }.
 */
function parsearGuiaMovilizacion(texto) {
  const lineas = String(texto || '').replace(/\r/g, '').split('\n').map((l) => l.replace(/[  ]+/g, ' ').trim());
  const todo = lineas.join('\n');
  const avisos = [];

  const mNum = todo.match(/\bN(?:o|º|°|ro)\.?\s*:?\s*([A-Z]{1,3}\s?\d{5,9})\b/i) || todo.match(/\bgu[ií]a\s*:?\s*([A-Z]{1,3}\d{5,9})\b/i);
  const numero = mNum ? mNum[1].replace(/\s/g, '').toUpperCase() : null;
  const fecha = fechaGuia(valorDe(lineas, [/^fecha\s*:/i, /^fecha\b/i]));
  const hora = horaGuia(valorDe(lineas, [/^hora\s*:/i, /^hora\b/i]));
  const autTxt = valorDe(lineas, [/^autorizaci[oó]n\s*:/i, /n[uú]mero de autorizaci[oó]n/i]);
  const autorizacion = autTxt ? ((autTxt.match(/\b[A-Z0-9]{6,20}\b/) || [])[0] || null) : null;

  const cue = (v) => (v ? ((v.match(/\d{13}/) || [])[0] || null) : null);
  const origen = {
    nombre: valorDe(lineas, [/^origen\s*:/i, /que da origen al movimiento/i]),
    establecimiento: valorDe(lineas, [/^establecimiento (?:de )?origen\s*:/i, /establecimiento de origen(?:\s*c[oó]digo alterno)?/i]),
    cue: cue(valorDe(lineas, [/^cue (?:de )?origen\s*:?/i])),
  };
  const destino = {
    nombre: valorDe(lineas, [/^destino\s*:/i, /persona de destino/i]),
    establecimiento: valorDe(lineas, [/^establecimiento (?:de )?destino\s*:/i, /establecimiento de destino(?:\s*c[oó]digo alterno)?/i]),
    cue: cue(valorDe(lineas, [/^cue (?:de )?destino\s*:?/i])),
  };
  const transportista = soloNombre(valorDe(lineas, [/^transportista\s*:/i, /nombre del transportista(?:.*veh[ií]culo)?/i]));
  const conductor = soloNombre(valorDe(lineas, [/^conductor\s*:/i, /nombre del conductor(?:.*veh[ií]culo)?/i]));
  let placa = valorDe(lineas, [/^placa\s*:/i]);
  if (!placa) {
    // En el PDF la placa queda en las líneas entre el transportista y el conductor («C 175410/ Carreta…»).
    const i = lineas.findIndex((l) => /nombre del transportista/i.test(l));
    const f = lineas.findIndex((l) => /nombre del conductor/i.test(l));
    if (i >= 0 && f > i) {
      for (const l of lineas.slice(i + 1, f)) {
        const m = l.match(/(?:^|[\s\d])([A-Z]{1,3} ?\d{4,6})(?=\/|\s|$)/);
        if (m) { placa = m[1]; break; }
      }
    }
  }
  if (placa) placa = placa.replace(/\s*\/.*$/, '').trim().slice(0, 40);
  // pdf-parse pega «ESPECIEBOVINA»: sin \b al inicio.
  const totTxt = valorDe(lineas, [/^bovinos\s*:/i, /bovina\b/i]);
  const total = totTxt && /^\d{1,4}\b/.test(totTxt) ? Number(totTxt.match(/^\d+/)[0]) : null;

  // Tabla de animales: desde su título; si el texto no lo trae (pegaron solo la tabla), desde el
  // inicio, saltando las líneas del CUE.
  let inicio = lineas.findIndex((l) => /\bDIIO\b|dispositivos de identificaci[oó]n/i.test(l));
  const conTitulo = inicio >= 0;
  if (!conTitulo) inicio = 0;
  const animales = [];
  for (let i = inicio; i < lineas.length; i++) {
    const l = lineas[i];
    if (animales.length && FIN_TABLA.test(l)) break;
    if (!conTitulo && (/\bcue\b/i.test(l) || (i > 0 && /\bcue\b/i.test(lineas[i - 1])))) continue;
    const m = l.match(RE_DIIO);
    if (!m) continue;
    // Orden: el número al inicio de la línea (lectura por foto) o la línea anterior (PDF).
    const antes = l.slice(0, m.index).trim();
    let orden = /^\d{1,3}$/.test(antes) ? Number(antes) : null;
    if (orden == null && i > 0 && /^\d{1,3}$/.test(lineas[i - 1])) orden = Number(lineas[i - 1]);
    // Lo que sigue al DIIO: el resto de la línea y las líneas siguientes hasta el próximo DIIO.
    const piezas = l.slice(m.index + m[0].length).split(/\t|\s{2,}/).map((x) => x.trim()).filter(Boolean);
    for (let j = i + 1; j < Math.min(lineas.length, i + 5) && !RE_DIIO.test(lineas[j]) && !FIN_TABLA.test(lineas[j]); j++) {
      piezas.push(...lineas[j].split(/\t|\s{2,}/).map((x) => x.trim()).filter(Boolean));
    }
    let sr = null;
    const utiles = piezas.filter((p) => !MARCA.test(p) && !/^\d{1,3}$/.test(p));
    for (let k = 0; k < utiles.length && !sr; k++) {
      // «H» sola y la raza en la pieza siguiente (Word o lectura por foto), o pegadas (PDF).
      if (/^(MC|M|H)$/.test(utiles[k])) sr = { sexo: utiles[k], raza: utiles[k + 1] && !/^(MC|M|H)$/.test(utiles[k + 1]) ? utiles[k + 1] : null };
      else sr = sexoRaza(utiles[k].replace(/^[üÜ✓✔√]\s*/, ''));
    }
    animales.push({ orden: orden ?? animales.length + 1, diio: m[1], sexo: sr ? sr.sexo : null, raza: sr && sr.raza ? sr.raza.slice(0, 100) : null });
  }
  if (total != null && animales.length && total !== animales.length) {
    avisos.push(`La guía dice ${total} bovino(s) y se leyeron ${animales.length}: revise si falta una página o una fila`);
  }
  return { numero, fecha, hora, autorizacion, origen, destino, transportista, placa, conductor, total_bovinos: total, animales, avisos };
}

/**
 * Clave para comparar un DIIO de la guía con la I.E. de Ganadero SG. Son el mismo chip escrito
 * distinto: la guía trae el número oficial (188 + serie, p. ej. 188001057994) y Ganadero SG la I.E.
 * completa con prefijo y ceros (A0020000188000001057859). Se compara «188» + la serie sin ceros a la
 * izquierda. Un número sin el 188 se compara por sus dígitos sin ceros a la izquierda.
 */
function claveChip(v) {
  const d = String(v || '').replace(/\D/g, '');
  if (!d) return null;
  const m = d.match(/188(0*)(\d+)$/);
  if (m && m[2].length >= 5) return `188:${m[2]}`;
  const sinCeros = d.replace(/^0+/, '');
  return sinCeros.length >= 5 ? sinCeros : null;
}

/** Serie del chip (lo que va detrás de 188 y los ceros): para buscar con LIKE '%serie'. */
const serieChip = (v) => { const c = claveChip(v); return c ? c.replace(/^188:/, '') : null; };

const SEXO_TEXTO = { H: 'hembra', M: 'macho', MC: 'macho castrado' };

module.exports = { parsearGuiaMovilizacion, claveChip, serieChip, fechaGuia, horaGuia, sexoRaza, SEXO_TEXTO };
