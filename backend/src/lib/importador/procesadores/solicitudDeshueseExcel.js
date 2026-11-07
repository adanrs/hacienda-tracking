// Importa solicitudes de deshuese HISTÓRICAS desde el libro Excel de la planta
// («Solicitud_de_Deshuese_y_Porcionado.xlsx»: una hoja «Deshuese ddmmaa» por día de sacrificio).
//
// Una fila del plan = una hoja. Lectura (mapeo completo en docs/importadores/solicitud-deshuese.md):
//   - columnas de canal = las que dicen «Canal # n» en la fila de títulos (G, I, K, M, O…);
//   - datos por etiqueta de la columna B: Arete, Sexo, Padre, Peso en Pie, Peso Pie Planta, Peso
//     canal, Consecutivo («Cosesecutivo») Mes Sacrificio = n.º de canal, Lote de Deshuese, Marble Score;
//   - cortes: filas debajo de «Codigo», código CIISA en B, nombre en E, medias 0/1/2 en la celda de
//     cada canal (si es fórmula se toma su resultado guardado); filas sin código o con código que no
//     está en el catálogo van con el 99 «pendiente de codificar» y el nombre en `corte_informado`.
//   - fecha del sacrificio: del nombre de la hoja («160524» = 16/05/24). Si el nombre es corto y
//     admite dos lecturas («18923»), la fila queda en error hasta indicar la fecha (opciones.fechas[hoja]).
// Cada canal se liga a un sacrificio REGISTRADO por n.º de canal del día o, si no, por arete. Las
// canales sin sacrificio se listan como aviso; una hoja sin ninguna canal ligada es error. No se
// pisa una solicitud que ya exista para esa fecha. Las importadas quedan en estado «deshuesada».

const ExcelJS = require('exceljs');
const { marcas, fechaTexto, fmtFechaSql, claveArete } = require('../comun');
const { parsearFecha } = require('../texto');
const { CODIGO_PENDIENTE } = require('../../catalogoCortes');

const ETIQUETAS = [
  ['arete', /^arete/], ['sexo', /^sexo/], ['padre', /^padre/], ['peso_pie', /^peso en pie/],
  ['peso_planta', /^peso pie planta/], ['peso_canal', /^peso canal/], ['consecutivo', /^co[sn]+ecutivo/],
  ['lote', /^lote de deshuese/], ['marmoleo', /^marble/],
];
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

function valor(celda) {
  const v = celda.value;
  if (v == null) return null;
  if (typeof v === 'object') {
    if (v.result !== undefined) return v.result;
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if (v instanceof Date) return v;
    if (v.formula || v.sharedFormula) return null; // fórmula sin resultado guardado
    if (v.text) return v.text;
  }
  return v;
}

/** Fecha(s) posibles del nombre de la hoja: «Deshuese 160524», «Deshuses 8223», « Deshuese 151123». */
function fechasDeNombre(nombre) {
  const m = /(\d{4,6})\s*$/.exec(String(nombre).trim());
  if (!m) return [];
  const t = m[1];
  const anio = t.slice(-2);
  const resto = t.slice(0, -2);
  const opciones = [];
  for (let i = 1; i < resto.length; i++) {
    const d = resto.slice(0, i); const mes = resto.slice(i);
    if (d.length > 2 || mes.length > 2) continue;
    const f = parsearFecha(`${d}/${mes}/${anio}`, 'dmy');
    if (typeof f === 'string' && !opciones.includes(f)) opciones.push(f);
  }
  return opciones;
}

function leerHoja(hoja) {
  const filasEtiqueta = {};
  let filaTitulos = null;
  let filaCodigo = null;
  const limite = Math.min(hoja.rowCount, 40);
  for (let f = 1; f <= limite; f++) {
    const b = norm(valor(hoja.getCell(f, 2)));
    for (const [clave, re] of ETIQUETAS) if (!filasEtiqueta[clave] && re.test(b)) filasEtiqueta[clave] = f;
    if (b === 'codigo' && !filaCodigo) filaCodigo = f;
    if (!filaTitulos) {
      hoja.getRow(f).eachCell((c) => { if (/^canal\s*#\s*\d+/i.test(String(valor(c) || ''))) filaTitulos = f; });
    }
  }
  if (!filaTitulos || !filasEtiqueta.arete) return null;
  const columnas = [];
  hoja.getRow(filaTitulos).eachCell((c, col) => { if (/^canal\s*#\s*\d+/i.test(String(valor(c) || ''))) columnas.push(col); });
  const canales = columnas.map((col) => {
    const dato = (clave) => (filasEtiqueta[clave] ? valor(hoja.getCell(filasEtiqueta[clave], col)) : null);
    const n = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
    return {
      columna: hoja.getColumn(col).letter,
      col,
      arete: dato('arete') == null ? null : String(dato('arete')).trim().toUpperCase() || null,
      sexo: dato('sexo') ? String(dato('sexo')).trim().toUpperCase() : null,
      padre: dato('padre') == null ? null : String(dato('padre')).trim() || null,
      peso_pie: n(dato('peso_pie')), peso_planta: n(dato('peso_planta')), peso_canal: n(dato('peso_canal')),
      numero_canal: dato('consecutivo') == null ? null : String(dato('consecutivo')).replace(/\.0+$/, '').trim() || null,
      lote: dato('lote'), marmoleo: n(dato('marmoleo')),
    };
  }).filter((c) => c.arete || c.numero_canal);

  const cortes = [];
  if (filaCodigo) {
    let vacias = 0;
    for (let f = filaCodigo + 1; f <= Math.min(hoja.rowCount, filaCodigo + 70) && vacias < 6; f++) {
      const codigoCrudo = valor(hoja.getCell(f, 2));
      const nombre = valor(hoja.getCell(f, 5));
      const nombreTxt = nombre == null ? '' : String(nombre).replace(/\s+/g, ' ').trim();
      if (/bch fresco|total de bch|trim usado/i.test(nombreTxt)) break; // de aquí abajo es el cálculo de proceso
      const medias = {};
      let alguna = false;
      for (const c of canales) {
        const v = valor(hoja.getCell(f, c.col));
        if (v === 0 || v === 1 || v === 2) { medias[c.columna] = v; alguna = true; }
      }
      if (codigoCrudo == null && !nombreTxt) { vacias++; continue; }
      vacias = 0;
      if (!alguna) continue;
      const codigo = codigoCrudo == null ? null : String(codigoCrudo).replace(/\.0+$/, '').trim();
      const obs = valor(hoja.getCell(f, 17));
      cortes.push({ fila: f, codigo: codigo && /^\d{5}$/.test(codigo) ? codigo : null, nombre: nombreTxt.slice(0, 120), medias, observacion: obs ? String(obs).slice(0, 300) : null });
    }
  }
  return { canales, cortes };
}

// ── Texto (leído por foto o pegado) → hoja equivalente ───────────────────────
// La solicitud en papel no es una tabla con encabezado: canales en columnas y cortes en filas. La
// visión la devuelve en este texto (instrucciones en lib/vision.js), separado por tabuladores:
//   Deshuese 151026
//   Canal #	Canal # 1	Canal # 2
//   Arete	225MLE	438MLF
//   … (Sexo, Padre, Peso en Pie, Peso Pie Planta, Peso canal, Consecutivo…, Lote de Deshuese, Marble Score)
//   Codigo
//   22229	CH-CHUCK	2	2
// Para no tener un segundo lector, el texto se vuelca a una hoja de ExcelJS con la MISMA disposición
// que el libro de la planta (etiqueta en B, nombre del corte en E, canales en G, I, K…) y pasa por
// leerHoja. La columna Q (17) es la de observaciones del libro: ninguna canal cae ahí.
const COL_ETIQUETA = 2;
const COL_NOMBRE = 5;
const COL_OBSERVACION = 17;
function columnasCanal(n) {
  const cols = [];
  for (let c = 7; cols.length < n; c += 2) if (c !== COL_OBSERVACION) cols.push(c);
  return cols;
}
const numeroOTexto = (v) => {
  const t = String(v ?? '').trim();
  if (!t) return null;
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : t;
};

/** Texto → { nombre, hoja } (hoja de ExcelJS) o null si no parece una solicitud. PURO. */
function hojaDesdeTexto(texto) {
  const lineas = String(texto || '').split(/\r?\n/).map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim());
  if (!lineas.length) return null;
  let nombre = 'Deshuese (texto)';
  const titulo = lineas.findIndex((l) => /^\s*deshu?e?s+e?\s*\d{4,6}\s*$/i.test(l.replace(/\t/g, ' ')));
  if (titulo >= 0) { nombre = `Deshuese ${lineas[titulo].replace(/\D+/g, '')}`; lineas.splice(titulo, 1); }
  const celdas = lineas.map((l) => l.split('\t').map((c) => c.trim()));
  // Cuántas canales: la fila «Canal #» si viene; si no, el máximo de valores de la fila «Arete».
  const filaCanal = celdas.find((c) => /^canal\s*#?$/i.test(c[0] || '') || /^canal\s*#\s*\d+/i.test(c[0] || ''));
  const filaArete = celdas.find((c) => /^arete/i.test(norm(c[0])));
  if (!filaArete) return null;
  const nCanales = Math.max(filaCanal ? filaCanal.slice(/^canal\s*#\s*\d+/i.test(filaCanal[0]) ? 0 : 1).filter(Boolean).length : 0, filaArete.length - 1);
  if (nCanales < 1) return null;
  const cols = columnasCanal(nCanales);
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet('texto');
  let r = 1;
  // Fila de títulos de canal (aunque el texto no la traiga): leerHoja la necesita.
  cols.forEach((c, i) => { hoja.getCell(r, c).value = `Canal # ${i + 1}`; });
  r++;
  let enCortes = false;
  for (const c of celdas) {
    if (filaCanal && c === filaCanal) continue;
    if (!enCortes && norm(c[0]) === 'codigo') { hoja.getCell(r, COL_ETIQUETA).value = 'Codigo'; enCortes = true; r++; continue; }
    if (enCortes) {
      // código, nombre y una media por canal; el código puede venir vacío («\tLomito\t2\t2»).
      hoja.getCell(r, COL_ETIQUETA).value = numeroOTexto(c[0]);
      hoja.getCell(r, COL_NOMBRE).value = c[1] || null;
      cols.forEach((col, i) => { hoja.getCell(r, col).value = numeroOTexto(c[2 + i]); });
    } else {
      hoja.getCell(r, COL_ETIQUETA).value = c[0] || null;
      cols.forEach((col, i) => { hoja.getCell(r, col).value = numeroOTexto(c[1 + i]); });
    }
    r++;
  }
  return { nombre, hoja };
}

async function planificar(conn, _tabla, opciones = {}, { lectura }) {
  const fechasElegidas = { ...(opciones.fechas && typeof opciones.fechas === 'object' ? opciones.fechas : {}) };
  const soloHojas = Array.isArray(opciones.hojas) && opciones.hojas.length ? new Set(opciones.hojas.map(String)) : null;
  const filas = [];
  // Hojas a leer: las «Deshuese ddmmaa» de cada libro y, si vino texto (foto o pegado), su hoja equivalente.
  const hojas = [];
  for (const doc of lectura.documentos) {
    if (doc.pegado) {
      const h = hojaDesdeTexto(doc.texto);
      if (!h) {
        filas.push({ fila: filas.length + 1, entidad: 'solicitud', clave: 'texto', accion: 'error', errores: ['El texto no tiene el formato de solicitud: falta la línea «Arete» con un valor por canal'], avisos: [], cambios: [] });
        continue;
      }
      // Sin «Deshuese ddmmaa» en el texto, la fecha la da la pantalla (opciones.fecha_texto).
      if (opciones.fecha_texto && !fechasElegidas[h.nombre]) fechasElegidas[h.nombre] = String(opciones.fecha_texto);
      hojas.push({ nombre: h.nombre, hoja: h.hoja });
      continue;
    }
    if (!doc.buffer) continue;
    const libro = new ExcelJS.Workbook();
    try { await libro.xlsx.load(doc.buffer); } catch (_) {
      filas.push({ fila: filas.length + 1, entidad: 'solicitud', clave: doc.nombre, accion: 'error', errores: ['No se pudo leer el Excel'], avisos: [], cambios: [] });
      continue;
    }
    for (const hoja of libro.worksheets) hojas.push({ nombre: hoja.name.trim(), hoja });
  }
  for (const { nombre, hoja } of hojas) {
    if (!/^deshuse?s?e?s?\s/i.test(nombre) && !/^deshuese/i.test(nombre)) continue;
    if (soloHojas && !soloHojas.has(nombre)) continue;
    const item = { fila: filas.length + 1, entidad: 'solicitud', hoja: nombre, clave: nombre, accion: 'nuevo', errores: [], avisos: [], cambios: [] };
    filas.push(item);
    const leida = leerHoja(hoja);
    if (!leida) { item.errores.push('No tiene el formato de solicitud (faltan «Canal #» o «Arete»)'); item.accion = 'error'; continue; }
    const posibles = fechasDeNombre(nombre);
    const elegida = fechasElegidas[nombre] ? parsearFecha(fechasElegidas[nombre], 'dmy') : null;
    item.fechas_posibles = posibles;
    if (typeof elegida === 'string') item.fecha = elegida;
    else if (posibles.length === 1) item.fecha = posibles[0];
    else if (posibles.length > 1) item.errores.push(`El nombre «${nombre}» admite varias fechas (${posibles.map(fechaTexto).join(' o ')}): indique cuál`);
    else item.errores.push(`No se pudo sacar la fecha del nombre «${nombre}»: indíquela`);
    item.canales = leida.canales.map((c) => ({ ...c, col: undefined }));
    item.cortes = leida.cortes;
    item.total_canales = leida.canales.length;
    item.total_cortes = leida.cortes.length;
  }
  if (!filas.length) return { filas: [], errores_generales: ['El libro no trae hojas «Deshuese ddmmaa»'] };

  // Contra la base: sacrificios del día por canal/arete, solicitudes existentes y catálogo.
  const fechas = [...new Set(filas.map((f) => f.fecha).filter(Boolean))];
  let sacr = []; let sols = []; let enOtra = [];
  if (fechas.length) {
    [sacr] = await conn.query(
      `SELECT s.id, s.animal_id, s.numero_canal, ${fmtFechaSql('s.fecha_dia', 'fecha')}, a.numero_trazabilidad FROM sacrificios s JOIN animales a ON a.id = s.animal_id
       WHERE s.fecha_dia IN (${marcas(fechas.length)})`, fechas);
    [sols] = await conn.query(`SELECT id, numero, ${fmtFechaSql('fecha_sacrificio', 'fecha')} FROM solicitudes_deshuese WHERE fecha_sacrificio IN (${marcas(fechas.length)})`, fechas);
  }
  if (sacr.length) [enOtra] = await conn.query(`SELECT sacrificio_id FROM solicitud_canales WHERE sacrificio_id IN (${marcas(sacr.length)})`, sacr.map((s) => s.id));
  const ocupados = new Set(enOtra.map((x) => x.sacrificio_id));
  const codigos = [...new Set(filas.flatMap((f) => (f.cortes || []).map((c) => c.codigo).filter(Boolean)))];
  let cat = [];
  if (codigos.length) [cat] = await conn.query(`SELECT codigo FROM catalogo_cortes WHERE codigo IN (${marcas(codigos.length)})`, codigos);
  const enCatalogo = new Set(cat.map((c) => String(c.codigo)));

  for (const f of filas) {
    if (!f.canales || !f.fecha) { if (f.errores.length) f.accion = 'error'; continue; }
    const ya = sols.find((s) => s.fecha === f.fecha);
    if (ya) { f.errores.push(`Ya existe la solicitud n.º ${ya.numero} del ${fechaTexto(f.fecha)}: no se reemplaza`); }
    const delDia = sacr.filter((s) => s.fecha === f.fecha);
    for (const c of f.canales) {
      const s = (c.numero_canal && delDia.find((x) => String(x.numero_canal || '').toUpperCase() === c.numero_canal.toUpperCase()))
        || (c.arete && delDia.find((x) => claveArete(x.numero_trazabilidad) === claveArete(c.arete)));
      if (!s) { c.sin_sacrificio = true; f.avisos.push(`Canal ${c.columna} (${c.arete || 's/arete'}, n.º ${c.numero_canal || 's/n'}): no hay sacrificio registrado ese día; no se importa`); continue; }
      if (ocupados.has(s.id)) { c.sin_sacrificio = true; f.avisos.push(`Canal ${c.columna} (${s.numero_trazabilidad}) ya está en otra solicitud`); continue; }
      if (c.arete && claveArete(c.arete) !== claveArete(s.numero_trazabilidad)) f.avisos.push(`Canal ${c.columna}: la hoja dice ${c.arete}, el sacrificio n.º ${s.numero_canal} es de ${s.numero_trazabilidad}`);
      c.sacrificio_id = s.id;
      c.arete_registrado = s.numero_trazabilidad;
    }
    const ligadas = f.canales.filter((c) => c.sacrificio_id);
    f.canales_ligadas = ligadas.length;
    if (!ligadas.length) f.errores.push('Ninguna canal de la hoja tiene sacrificio registrado en la app');
    const pend = [];
    for (const c of f.cortes) {
      if (!c.codigo || !enCatalogo.has(c.codigo)) { c.pendiente = true; pend.push(c.codigo ? `${c.codigo} ${c.nombre}` : c.nombre); }
    }
    if (pend.length) f.avisos.push(`Cortes sin código o fuera del catálogo, van como 99 «pendiente de codificar»: ${pend.join('; ')}`);
    // Llave de cada fila en solicitud_lineas = (canal, código, corte_informado). La plantilla repite
    // códigos (22101 = «Lomito» y «Lomito (Cabeza)»): esas filas se distinguen por su NOMBRE en
    // corte_informado; si aun así dos filas quedan iguales, se les agrega la fila de la hoja.
    const usadas = new Set();
    const repetidos = new Set(f.cortes.filter((c, i) => c.codigo && !c.pendiente && f.cortes.findIndex((x) => x.codigo === c.codigo && !x.pendiente) !== i).map((c) => c.codigo));
    for (const c of f.cortes) {
      c.codigo_final = c.pendiente ? CODIGO_PENDIENTE : c.codigo;
      let inf = c.pendiente ? (c.codigo ? `${c.codigo} ${c.nombre}` : c.nombre) : (repetidos.has(c.codigo) ? c.nombre || `fila ${c.fila}` : '');
      inf = String(inf).slice(0, 110);
      if (usadas.has(`${c.codigo_final}|${inf}`)) inf = `${inf} (fila ${c.fila})`.slice(0, 120);
      usadas.add(`${c.codigo_final}|${inf}`);
      c.informado = inf;
    }
    if (repetidos.size) f.avisos.push(`Código(s) repetidos en la hoja: ${[...repetidos].join(', ')}; se guardan como filas distintas por su nombre`);
    if (f.errores.length) f.accion = 'error';
  }
  return { filas, errores_generales: [] };
}

async function aplicar(conn, plan, { importacionId, usuarioId, registrar }) {
  const res = { solicitudes: 0, canales: 0, lineas: 0 };
  for (const f of plan.filas) {
    if (f.accion === 'error') continue;
    const [[{ siguiente }]] = await conn.query('SELECT COALESCE(MAX(numero), 0) + 1 AS siguiente FROM solicitudes_deshuese FOR UPDATE');
    const [ins] = await conn.query(
      `INSERT INTO solicitudes_deshuese (numero, fecha_sacrificio, estado, observaciones, creado_por, actualizado_por, importacion_id)
       VALUES (?, ?, 'deshuesada', ?, ?, ?, ?)`,
      [siguiente, f.fecha, f.leido_por_foto ? `Importada de una foto de la solicitud («${f.hoja}»)` : `Importada del Excel de la planta (hoja «${f.hoja}»)`, usuarioId || null, usuarioId || null, importacionId]);
    const sid = ins.insertId;
    const ligadas = f.canales.filter((c) => c.sacrificio_id);
    const idCanal = new Map();
    for (const [i, c] of ligadas.entries()) {
      const [r] = await conn.query('INSERT INTO solicitud_canales (solicitud_id, sacrificio_id, numero_canal, orden) VALUES (?, ?, ?, ?)',
        [sid, c.sacrificio_id, c.numero_canal ? String(c.numero_canal).slice(0, 10) : null, i + 1]);
      idCanal.set(c.columna, r.insertId);
      res.canales++;
    }
    const lineas = [];
    f.cortes.forEach((corte, i) => {
      for (const c of ligadas) {
        const m = corte.medias[c.columna];
        if (m === undefined) continue;
        lineas.push([sid, corte.codigo_final, corte.informado,
          idCanal.get(c.columna), m, corte.observacion, i + 1]);
      }
    });
    if (lineas.length) {
      await conn.query('INSERT INTO solicitud_lineas (solicitud_id, corte_codigo, corte_informado, solicitud_canal_id, medias, observacion, orden) VALUES ?', [lineas]);
      res.lineas += lineas.length;
    }
    registrar(f.fila, 'solicitud_deshuese', sid, 'creado', { hoja: f.hoja, fecha: f.fecha, canales: ligadas.length, cortes: f.cortes.length });
    res.solicitudes++;
  }
  return { resumen: res };
}

module.exports = { planificar, aplicar, fechasDeNombre, leerHoja, hojaDesdeTexto };
