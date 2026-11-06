// Procesador del «REPORTE DIARIO DE PRODUCCION» de CIISA: varios PDF (o texto pegado) por tanda.
//
// Cada PDF es UN animal: El Arreo normalmente deshuesa corridas de 30–60 animales por lote, pero a
// Wagyu Cross le hace el favor de tratar cada animal suyo como un lote independiente. El único sello
// canal ↔ arete es la lista del correo («2 → 225MLE, 3 → 348MLF…», por Num. Lote). Como es un
// acuerdo y no una garantía:
//   - si los kilos del reporte superan el 90 % del peso canal del animal se avisa «posible lote con
//     varios animales» (el rendimiento normal de deshuese ronda 70–84 %);
//   - un lote sin arete en la lista (o que no se puede ligar) se puede importar igual como «lote sin
//     animal» (sin trazabilidad) para no perder los datos; queda en el reporte de discrepancias.
//
// LA GUÍA MANDA (misma regla estricta que el sacrificio): el arete de la lista se busca entre los
// animales sacrificados de la guía (60 días antes de la producción) que todavía no tienen reporte.
// Si no está, se PROPONE el más parecido (distancia de edición ≤ 2: 348MLF → 438MLF) y la fila queda
// en error hasta que el usuario lo confirme (opciones.correcciones[lote]) o elija importarlo sin animal
// (opciones.sin_animal[lote]).
//
// Validaciones por reporte: códigos contra el catálogo (desconocido → error, salvo que se marque
// «pendiente» y se guarde como 99; inactivo → aviso), suma de líneas = pie (kg y lb con tolerancia
// 0.1, cajas exactas), fecha de producción ≥ sacrificio, lote + fecha no cargado dos veces (mismo
// contenido → sin cambios; otro contenido → error) ni repetido en la tanda.
// Al aplicar: reporte_produccion (+ líneas, pie, PDF guardado), lotes_cc_aretes, un deshuese
// «cerrado» por animal (lo que antes se cargaba a mano en la pantalla Deshuese) y la solicitud de
// deshuese pasa a «con reporte» cuando todas sus canales lo tienen.

const fs = require('fs');
const path = require('path');
const { marcas, num, fmtFechaSql, fechaTexto, claveArete } = require('../comun');
const { distanciaEdicion, parsearFecha } = require('../texto');
const { leerReportes, leerMapaLotes } = require('../reporteCiisaTexto');
const { vencimientoDe } = require('../../vencimiento');
const { CODIGO_PENDIENTE } = require('../../catalogoCortes');

const LIBRAS_POR_KG = 2.20462;
const TOLERANCIA_PIE = 0.1;
const DIAS_SACRIFICIO = 60;
const RENDIMIENTO_MAX = 90; // % sobre canal: arriba de esto huele a lote con varios animales
const RENDIMIENTO_MIN = 50; // % sobre canal: abajo de esto falta producto o el animal no es ese
const r2 = (x) => Math.round(x * 100) / 100;
const DIR_PDF = path.join(__dirname, '..', '..', '..', '..', 'uploads', 'reporte-produccion');

const mapaOpcion = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? o : {});

async function candidatos(conn, fechas) {
  if (!fechas.length) return [];
  const desde = fechas.reduce((a, b) => (a < b ? a : b));
  const hasta = fechas.reduce((a, b) => (a > b ? a : b));
  const [filas] = await conn.query(
    `SELECT s.id AS sacrificio_id, s.animal_id, ${fmtFechaSql('s.fecha_dia', 'fecha_sacrificio')}, s.numero_canal,
            COALESCE(s.peso_canal_frio, s.peso_canal_caliente) AS peso_canal, a.numero_trazabilidad
     FROM sacrificios s JOIN animales a ON a.id = s.animal_id
     WHERE s.fecha_dia BETWEEN DATE_SUB(?, INTERVAL ? DAY) AND ?
     ORDER BY s.fecha_dia DESC`, [desde, DIAS_SACRIFICIO, hasta]);
  const ids = filas.map((f) => f.animal_id);
  let conReporte = [];
  if (ids.length) {
    [conReporte] = await conn.query(
      `SELECT l.animal_id, ${fmtFechaSql('l.fecha_deshuese', 'fecha')}, l.lote_cc FROM lotes_cc_aretes l
       JOIN reporte_produccion r ON r.fecha_produccion = l.fecha_deshuese AND r.lote_cc = l.lote_cc
       WHERE l.animal_id IN (${marcas(ids.length)})`, ids);
  }
  return filas.map((f) => ({
    ...f, peso_canal: num(f.peso_canal), clave: claveArete(f.numero_trazabilidad),
    reporte: conReporte.find((r) => r.animal_id === f.animal_id) || null,
  }));
}

async function catalogo(conn, codigos) {
  if (!codigos.length) return new Map();
  const [filas] = await conn.query(`SELECT codigo, nombre, activo, tipo FROM catalogo_cortes WHERE codigo IN (${marcas(codigos.length)})`, codigos);
  return new Map(filas.map((f) => [String(f.codigo), { ...f, activo: Number(f.activo) === 1 }]));
}

async function existentes(conn, claves) {
  if (!claves.length) return [];
  const cond = claves.map(() => '(r.fecha_produccion = ? AND r.lote_cc = ?)').join(' OR ');
  const [filas] = await conn.query(
    `SELECT r.id, ${fmtFechaSql('r.fecha_produccion', 'fecha')}, r.lote_cc,
            (SELECT GROUP_CONCAT(CONCAT(l.articulo_codigo, ':', l.codigo_informado, ':', ROUND(l.peso_kg, 2), ':', l.cajas) ORDER BY l.articulo_codigo, l.codigo_informado SEPARATOR '|')
               FROM reporte_produccion_lineas l WHERE l.reporte_id = r.id) AS firma
     FROM reporte_produccion r WHERE ${cond}`, claves.flatMap((c) => [c.fecha, c.lote_cc]));
  return filas;
}

const firmaDe = (lineas) => [...lineas]
  .map((l) => `${l.articulo_codigo}:${l.codigo_informado || ''}:${r2(l.peso_kg).toFixed(2)}:${l.cajas}`)
  .sort().join('|');

async function planificar(conn, _tabla, opciones = {}, { lectura }) {
  const correcciones = mapaOpcion(opciones.correcciones);
  const sinAnimal = mapaOpcion(opciones.sin_animal);
  const pendientes = mapaOpcion(opciones.pendientes);
  const reemplazarArete = mapaOpcion(opciones.reemplazar_arete);
  const { mapa, repetidos } = leerMapaLotes(opciones.mapa || '');
  const errores_generales = [];
  if (repetidos.length) errores_generales.push(`La lista lote → arete trae el lote ${repetidos.join(', ')} con dos aretes distintos.`);

  // 1. Leer todos los reportes de todos los documentos.
  const reportes = [];
  const sinLeer = [];
  lectura.documentos.forEach((doc, idx) => {
    if (doc.requiereVision) { sinLeer.push({ doc: idx, nombre: doc.nombre }); return; }
    const leidos = leerReportes(doc.texto);
    if (!leidos.length) { sinLeer.push({ doc: idx, nombre: doc.nombre || 'Texto pegado', motivo: 'no trae «REPORTE DIARIO DE PRODUCCION»' }); return; }
    leidos.forEach((r, j) => reportes.push({ ...r, doc: idx, documento: doc.nombre || 'Texto pegado', parte: leidos.length > 1 ? j + 1 : null }));
  });

  const fechas = [...new Set(reportes.map((r) => r.fecha).filter(Boolean))];
  const cand = await candidatos(conn, fechas);
  const porClave = new Map();
  for (const c of cand) if (!porClave.has(c.clave)) porClave.set(c.clave, c);
  const codigos = [...new Set(reportes.flatMap((r) => r.lineas.map((l) => l.articulo_codigo)))];
  const cat = await catalogo(conn, codigos);
  const claves = reportes.filter((r) => r.fecha && r.lote_cc).map((r) => ({ fecha: r.fecha, lote_cc: r.lote_cc }));
  const yaCargados = await existentes(conn, claves);
  // Aretes ya cargados (a mano en «Aretes por posición» o por otra importación) para las mismas
  // fecha + lote: aplicar los pisaría con ON DUPLICATE, así que un cambio se confirma explícitamente.
  let mapeosPrevios = [];
  if (claves.length) {
    [mapeosPrevios] = await conn.query(
      `SELECT ${fmtFechaSql('fecha_deshuese', 'fecha')}, lote_cc, arete FROM lotes_cc_aretes WHERE ${claves.map(() => '(fecha_deshuese = ? AND lote_cc = ?)').join(' OR ')}`,
      claves.flatMap((c) => [c.fecha, c.lote_cc]));
  }

  const filas = [];
  const discrepancias = [];
  const usados = new Set();
  const vistos = new Map();

  // Primero los aretes exactos, para que las propuestas solo usen los que quedan libres.
  for (const r of reportes) {
    const lote = r.num_lote;
    const corr = lote != null ? correcciones[lote] : null;
    r.areteLista = lote != null ? mapa.get(lote) || null : null;
    r.areteBuscado = corr != null && String(corr).trim() ? claveArete(corr) : (r.areteLista ? claveArete(r.areteLista) : null);
    r.confirmadoAMano = Boolean(corr != null && String(corr).trim() && claveArete(corr) !== claveArete(r.areteLista || ''));
    if (r.areteBuscado && porClave.has(r.areteBuscado)) { r.animal = porClave.get(r.areteBuscado); usados.add(r.animal.clave); }
  }

  reportes.forEach((r, i) => {
    const etiquetaLote = r.num_lote ? `lote ${r.num_lote}` : 'lote ?';
    const f = {
      fila: i + 1, entidad: 'reporte', documento: r.documento, parte: r.parte,
      clave: `${r.fecha || '?'} · ${etiquetaLote}`, accion: 'nuevo', errores: [...r.errores], avisos: [], cambios: [],
      fecha_produccion: r.fecha, num_lote: r.num_lote, lote_cc: r.lote_cc, tipo_produccion: r.tipo_produccion,
      arete_lista: r.areteLista, kilos: null, cajas: null, rendimiento: null, peso_canal: null,
      vencimiento: r.fecha ? vencimientoDe(r.fecha) : null, trazabilidad: 'sin_trazabilidad',
    };
    filas.push(f);
    if (r.lote_cc && r.num_lote && Number(r.num_lote) !== Number(r.lote_cc)) {
      f.avisos.push(`Num. Lote ${r.num_lote} y Lote CC ${r.lote_cc} no coinciden: el mapa de aretes usa el Num. Lote`);
    }

    // Duplicado dentro de la tanda.
    const k = `${r.fecha}|${r.lote_cc}`;
    if (r.fecha && r.lote_cc) {
      if (vistos.has(k)) {
        f.errores.push(`El ${etiquetaLote} del ${fechaTexto(r.fecha)} viene dos veces en la tanda (también en la fila ${vistos.get(k)})`);
      } else vistos.set(k, f.fila);
    }

    // Líneas: catálogo y pendientes.
    const lineas = r.lineas.map((l, j) => {
      const c = cat.get(l.articulo_codigo);
      const linea = { ...l, linea: j + 1, codigo_informado: '', estado_codigo: 'ok', nombre_catalogo: c ? c.nombre : null };
      if (!c) {
        if (pendientes[l.articulo_codigo]) {
          linea.estado_codigo = 'pendiente';
          linea.codigo_informado = l.articulo_codigo;
          linea.articulo_codigo = CODIGO_PENDIENTE;
          f.avisos.push(`Código ${l.articulo_codigo} (${l.descripcion || 's/d'}) se guarda como 99 «pendiente de codificar»`);
        } else {
          linea.estado_codigo = 'desconocido';
          f.errores.push(`Código ${l.articulo_codigo} «${l.descripcion || ''}» no está en el catálogo: dé de alta el corte o márquelo pendiente (99)`);
        }
      } else if (!c.activo) {
        linea.estado_codigo = 'inactivo';
        f.avisos.push(`Código ${l.articulo_codigo} está inactivo en el catálogo`);
      }
      return linea;
    });
    f.lineas = lineas;
    f.codigos_desconocidos = lineas.filter((l) => l.estado_codigo === 'desconocido').map((l) => ({ codigo: l.articulo_codigo, descripcion: l.descripcion }));

    // Totales contra el pie.
    const kilos = r2(lineas.reduce((a, l) => a + l.peso_kg, 0));
    const cajas = lineas.reduce((a, l) => a + l.cajas, 0);
    f.kilos = kilos; f.cajas = cajas; f.pie = r.pie;
    if (r.pie) {
      if (Math.abs(kilos - r.pie.kilos) > TOLERANCIA_PIE) f.errores.push(`La suma de las líneas da ${kilos.toFixed(2)} kg y el pie dice ${r.pie.kilos.toFixed(2)} kg`);
      const libras = r2(kilos * LIBRAS_POR_KG);
      if (Math.abs(libras - r.pie.libras) > TOLERANCIA_PIE) f.errores.push(`La suma en libras da ${libras.toFixed(2)} y el pie dice ${r.pie.libras.toFixed(2)}`);
      if (cajas !== r.pie.cajas) f.errores.push(`La suma de cajas da ${cajas} y el pie dice ${r.pie.cajas}`);
      if (r.num_lote && String(Number(r.pie.lote)) !== r.num_lote) f.avisos.push(`El pie dice lote ${r.pie.lote} y el encabezado ${r.num_lote}`);
    }

    // Animal: lista lote → arete validada contra la guía (sacrificios).
    const quiereSinAnimal = r.num_lote != null && sinAnimal[r.num_lote];
    let animal = r.animal;
    if (!animal && r.areteBuscado && !quiereSinAnimal) {
      const libres = cand.filter((c) => !usados.has(c.clave) && !c.reporte);
      const props = libres.map((c) => ({ c, d: distanciaEdicion(r.areteBuscado, c.clave, 2) })).filter((x) => x.d <= 2).sort((a, b) => a.d - b.d);
      if (props.length && (props.length === 1 || props[0].d < props[1].d)) {
        const p = props[0].c;
        usados.add(p.clave);
        f.correccion = { informado: r.areteLista, propuesto: p.numero_trazabilidad, distancia: props[0].d };
        f.errores.push(`El arete ${r.areteLista} de la lista no está entre los sacrificados: ¿es ${p.numero_trazabilidad}? Confírmelo o impórtelo sin animal`);
        discrepancias.push(`Lote ${r.num_lote} del ${fechaTexto(r.fecha)}: el arete ${r.areteLista} no está en la guía; corresponde a ${p.numero_trazabilidad} (posible error de digitación).`);
      } else {
        f.errores.push(`El arete ${r.areteLista || r.areteBuscado} no está entre los animales sacrificados los ${DIAS_SACRIFICIO} días previos${props.length > 1 ? ` (¿${props.filter((x) => x.d === props[0].d).map((x) => x.c.numero_trazabilidad).join(' o ')}?)` : ''}: escriba el correcto o impórtelo sin animal`);
        discrepancias.push(`Lote ${r.num_lote} del ${fechaTexto(r.fecha)}: el arete ${r.areteLista} no corresponde a ningún animal sacrificado.`);
      }
    }
    if (!animal && !r.areteLista && !quiereSinAnimal && !(r.num_lote && correcciones[r.num_lote])) {
      f.avisos.push(`El lote ${r.num_lote || '?'} no viene en la lista lote → arete: se importa como LOTE SIN ANIMAL (sin trazabilidad)`);
      discrepancias.push(`Lote ${r.num_lote || '?'} del ${fechaTexto(r.fecha)}: falta el arete en la lista del correo (sin trazabilidad).`);
    }
    if (quiereSinAnimal) {
      animal = null;
      f.avisos.push('Se importa como LOTE SIN ANIMAL por decisión del usuario (sin trazabilidad)');
      discrepancias.push(`Lote ${r.num_lote} del ${fechaTexto(r.fecha)}: importado sin animal (arete informado ${r.areteLista || 'ninguno'}).`);
    }
    if (animal) {
      if (animal.reporte && !(animal.reporte.fecha === r.fecha && Number(animal.reporte.lote_cc) === Number(r.lote_cc))) {
        f.errores.push(`${animal.numero_trazabilidad} ya tiene reporte de producción (lote ${animal.reporte.lote_cc} del ${fechaTexto(animal.reporte.fecha)})`);
      }
      f.animal_id = animal.animal_id;
      f.arete = animal.numero_trazabilidad;
      f.sacrificio_id = animal.sacrificio_id;
      f.fecha_sacrificio = animal.fecha_sacrificio;
      f.numero_canal = animal.numero_canal;
      f.peso_canal = animal.peso_canal;
      f.trazabilidad = r.confirmadoAMano ? 'confirmada_a_mano' : 'con_arete';
      if (r.confirmadoAMano) {
        f.avisos.push(`Arete confirmado a mano: la lista dice ${r.areteLista || '—'}, es ${animal.numero_trazabilidad}`);
        discrepancias.push(`Lote ${r.num_lote} del ${fechaTexto(r.fecha)}: la lista dice ${r.areteLista || '—'}, corresponde a ${animal.numero_trazabilidad}.`);
      }
      if (r.fecha && animal.fecha_sacrificio > r.fecha) f.errores.push(`La producción (${fechaTexto(r.fecha)}) es anterior al sacrificio (${fechaTexto(animal.fecha_sacrificio)})`);
      if (animal.peso_canal) {
        f.rendimiento = r2((kilos / animal.peso_canal) * 100);
        if (f.rendimiento > RENDIMIENTO_MAX) {
          f.avisos.push(`Rendimiento ${f.rendimiento} % del peso canal (${animal.peso_canal} kg): posible lote con varios animales, revise`);
          discrepancias.push(`Lote ${r.num_lote} del ${fechaTexto(r.fecha)} (${animal.numero_trazabilidad}): ${kilos} kg de deshuese sobre ${animal.peso_canal} kg de canal (${f.rendimiento} %), ¿lote con varios animales?`);
        } else if (f.rendimiento < RENDIMIENTO_MIN) {
          f.avisos.push(`Rendimiento ${f.rendimiento} % del peso canal: muy bajo, ¿falta producto o es otro animal?`);
        }
      } else f.avisos.push('El sacrificio no tiene peso canal: no se calcula el rendimiento');
    }

    // Arete ya cargado para este lote y fecha.
    const mapeo = mapeosPrevios.find((m) => m.fecha === r.fecha && Number(m.lote_cc) === Number(r.lote_cc));
    if (mapeo && f.arete && claveArete(mapeo.arete) !== claveArete(f.arete)) {
      // La confirmación es por fecha + Lote CC (la misma llave del arete cargado): dos PDF con el mismo
      // Num. Lote en fechas distintas no se confirman juntos.
      f.clave_lote = `${r.fecha}|${r.lote_cc}`;
      f.cambio_arete = { antes: mapeo.arete, despues: f.arete };
      if (reemplazarArete[f.clave_lote]) {
        f.avisos.push(`Se reemplaza el arete ${mapeo.arete} que ya estaba cargado para este lote por ${f.arete} (confirmado)`);
        discrepancias.push(`Lote ${r.num_lote} del ${fechaTexto(r.fecha)}: estaba cargado con ${mapeo.arete} y se cambió a ${f.arete}.`);
      } else {
        f.errores.push(`Este lote ya tenía el arete ${mapeo.arete} cargado; la lista dice ${f.arete}. Confirme el reemplazo para continuar`);
      }
    } else if (mapeo && !f.arete) {
      f.avisos.push(`Ya hay un arete cargado a mano para este lote (${mapeo.arete}): el reporte quedará ligado a ese animal`);
    }

    // Ya cargado antes.
    const previo = yaCargados.find((y) => y.fecha === r.fecha && Number(y.lote_cc) === Number(r.lote_cc));
    if (previo) {
      if (previo.firma === firmaDe(lineas)) { f.accion = 'sin_cambios'; f.reporte_id = previo.id; } else {
        f.errores.push(`El lote ${r.lote_cc} del ${fechaTexto(r.fecha)} ya está cargado con otro contenido: bórrelo en la vista «Del día» antes de volver a cargarlo`);
      }
    }
    if (f.errores.length) f.accion = 'error';
  });

  for (const s of sinLeer) {
    filas.push({
      fila: filas.length + 1, entidad: 'reporte', documento: s.nombre, clave: s.nombre, accion: 'error', requiere_vision: !s.motivo,
      errores: [s.motivo ? `«${s.nombre}» ${s.motivo}` : `«${s.nombre}» es un PDF escaneado (sin texto): use «Leer por foto» para transcribirlo`],
      avisos: [], cambios: [], lineas: [], trazabilidad: 'sin_trazabilidad',
    });
  }

  // Animales de la lista que no vinieron en ningún PDF.
  const lotesLeidos = new Set(reportes.map((r) => r.num_lote));
  const faltantes = [...mapa.entries()].filter(([lote]) => !lotesLeidos.has(lote)).map(([lote, arete]) => ({ lote, arete }));
  if (faltantes.length) discrepancias.push(`La lista trae lotes sin PDF en esta tanda: ${faltantes.map((x) => `${x.lote} (${x.arete})`).join(', ')}.`);

  const validas = filas.filter((f) => f.accion !== 'error' && f.fecha_produccion);
  const traz = {
    total: validas.length,
    con_arete: validas.filter((f) => f.trazabilidad === 'con_arete').length,
    confirmada_a_mano: validas.filter((f) => f.trazabilidad === 'confirmada_a_mano').length,
    sin_trazabilidad: validas.filter((f) => f.trazabilidad === 'sin_trazabilidad').length,
  };
  traz.pct = traz.total ? Math.round(((traz.con_arete + traz.confirmada_a_mano) / traz.total) * 1000) / 10 : null;

  return {
    filas,
    errores_generales,
    faltantes,
    discrepancias,
    trazabilidad: traz,
    reporte_planta: textoReporte(discrepancias, filas, traz),
    resumen: { discrepancias: discrepancias.length, pct_trazabilidad: traz.pct },
  };
}

function textoReporte(discrepancias, filas, traz) {
  const l = ['Reporte de producción — revisión contra la guía de transporte y el sacrificio (Hacienda Tempisque)', ''];
  if (!discrepancias.length) l.push('Sin diferencias: cada lote tiene su arete y los totales cuadran.');
  else { l.push('Diferencias encontradas:'); for (const d of discrepancias) l.push(`- ${d}`); }
  l.push('', `Reportes recibidos: ${filas.length}; con trazabilidad: ${traz.con_arete + traz.confirmada_a_mano} de ${traz.total}${traz.pct != null ? ` (${traz.pct} %)` : ''}.`);
  l.push('Por favor confirmar los aretes señalados. Gracias.');
  return l.join('\n');
}

async function aplicar(conn, plan, { importacionId, usuarioId, registrar }) {
  const res = { reportes_nuevos: 0, sin_cambios: 0, deshueses: 0, solicitudes_con_reporte: 0, pdfs: 0 };
  const documentos = plan._documentos || [];
  const animales = [];
  for (const f of plan.filas) {
    if (f.accion === 'error') continue;
    if (f.accion === 'sin_cambios') { res.sin_cambios++; registrar(f.fila, 'reporte_produccion', f.reporte_id, 'sin_cambios', null); continue; }
    const doc = documentos.find((d) => d.nombre === f.documento) || null;
    const origen = doc && doc.buffer && doc.ext === 'pdf' ? 'pdf' : 'pegado';
    const [ins] = await conn.query(
      `INSERT INTO reporte_produccion (fecha_produccion, lote_cc, num_lote, tipo_produccion, origen, archivo_nombre, cargado_por,
                                       pie_kilos, pie_libras, pie_cajas, importacion_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [f.fecha_produccion, f.lote_cc, f.num_lote, f.tipo_produccion, origen, doc ? doc.nombre : null, usuarioId || null,
        f.pie ? f.pie.kilos : null, f.pie ? f.pie.libras : null, f.pie ? f.pie.cajas : null, importacionId]);
    const reporteId = ins.insertId;
    await conn.query(
      'INSERT INTO reporte_produccion_lineas (reporte_id, linea, articulo_codigo, codigo_informado, descripcion, peso_kg, unidad, cajas) VALUES ?',
      [f.lineas.map((l) => [reporteId, l.linea, l.articulo_codigo, l.codigo_informado || '', l.descripcion, l.peso_kg, 'KGS', l.cajas])]);

    // PDF original: se guarda con nombre generado por el servidor (nunca el del cliente).
    let pdfUrl = null;
    if (origen === 'pdf' && plan.filas.filter((x) => x.documento === f.documento).length === 1) {
      fs.mkdirSync(DIR_PDF, { recursive: true });
      const nombre = `${reporteId}-${Date.now()}.pdf`;
      fs.writeFileSync(path.join(DIR_PDF, nombre), doc.buffer);
      pdfUrl = `/uploads/reporte-produccion/${nombre}`;
      await conn.query('UPDATE reporte_produccion SET pdf_url = ? WHERE id = ?', [pdfUrl, reporteId]);
      res.pdfs++;
    }

    let deshueseId = null;
    if (f.animal_id) {
      // Deshuese de la app (la pantalla vieja «Deshuese»): uno por animal, cerrado, con el PDF.
      const [ya] = await conn.query('SELECT id FROM deshuese WHERE animal_id = ? AND DATE(fecha) = ? ORDER BY id LIMIT 1', [f.animal_id, f.fecha_produccion]);
      if (ya.length) deshueseId = ya[0].id; else {
        const base = `DES-${f.fecha_produccion.replace(/-/g, '')}-${f.sacrificio_id}`;
        const [d] = await conn.query(
          `INSERT INTO deshuese (numero_lote, sacrificio_id, animal_id, fecha, peso_entrada, responsable, pdf_url, estado, notas)
           VALUES (?, ?, ?, ?, ?, 'CIISA', ?, 'cerrado', ?)`,
          [base, f.sacrificio_id, f.animal_id, `${f.fecha_produccion} 00:00:00`, f.peso_canal, pdfUrl,
            `Reporte de producción CIISA lote ${f.num_lote} (${f.kilos} kg, ${f.cajas} cajas)`]);
        deshueseId = d.insertId;
        res.deshueses++;
      }
      await conn.query(
        `INSERT INTO lotes_cc_aretes (fecha_deshuese, lote_cc, arete, animal_id, deshuese_id, registrado_por) VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE arete = VALUES(arete), animal_id = VALUES(animal_id), deshuese_id = VALUES(deshuese_id), registrado_por = VALUES(registrado_por)`,
        [f.fecha_produccion, f.lote_cc, String(f.arete).slice(0, 10), f.animal_id, deshueseId, usuarioId || null]);
      animales.push(f.animal_id);
    }
    registrar(f.fila, 'reporte_produccion', reporteId, 'creado', {
      lote: f.num_lote, fecha: f.fecha_produccion, arete: f.arete || null, kilos: f.kilos, cajas: f.cajas,
      trazabilidad: f.trazabilidad, correccion: f.correccion || null, avisos: f.avisos,
    });
    res.reportes_nuevos++;
  }

  // Solicitud de deshuese → «con reporte» cuando TODAS sus canales tienen reporte de producción.
  if (animales.length) {
    const [sols] = await conn.query(
      `SELECT DISTINCT sc.solicitud_id FROM solicitud_canales sc JOIN sacrificios s ON s.id = sc.sacrificio_id
       JOIN solicitudes_deshuese sd ON sd.id = sc.solicitud_id
       WHERE s.animal_id IN (${marcas(animales.length)}) AND sd.estado IN ('enviada','deshuesada')`, animales);
    for (const { solicitud_id: sid } of sols) {
      const [[c]] = await conn.query(
        `SELECT COUNT(*) AS total,
                SUM(EXISTS (SELECT 1 FROM lotes_cc_aretes l JOIN reporte_produccion r ON r.fecha_produccion = l.fecha_deshuese AND r.lote_cc = l.lote_cc
                            WHERE l.animal_id = s.animal_id)) AS con_reporte
         FROM solicitud_canales sc JOIN sacrificios s ON s.id = sc.sacrificio_id WHERE sc.solicitud_id = ?`, [sid]);
      if (Number(c.total) > 0 && Number(c.total) === Number(c.con_reporte)) {
        await conn.query(`UPDATE solicitudes_deshuese SET estado = 'con_reporte', actualizado_por = ? WHERE id = ?`, [usuarioId || null, sid]);
        registrar(null, 'solicitud_deshuese', sid, 'actualizado', { estado: 'con_reporte' });
        res.solicitudes_con_reporte++;
      }
    }
  }
  return { resumen: res, reporte_planta: plan.reporte_planta };
}

module.exports = { planificar, aplicar, RENDIMIENTO_MAX, parsearFecha };
