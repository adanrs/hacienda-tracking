// Procesador de los documentos de custodia de CIISA: ajuste de salida (ASE) y traslado de
// inventario (TRE) de la bodega 107 EQTB TEMPISQUE.
//
// Cada documento (foto leída, PDF, .docx, .xlsx o texto pegado) es un ASE o un TRE con su número; la
// vista previa muestra el encabezado y una fila por artículo. Por qué así:
//   - La llave es tipo + número: re-importar no duplica; si el texto cambió (otra foto, más nítida)
//     se reemplazan las líneas del documento.
//   - El animal sale de las Observaciones («CORTES FINOS LOTE 35 / RES 5094»): LOTE = Lote CC (el
//     lote de deshuese; con la fecha identifica al animal, como en el reporte de producción) y RES =
//     n.º de canal del sacrificio. El documento es de DESPUÉS del deshuese, así que se buscan los
//     lotes CC y las canales de los 180 días anteriores a su fecha:
//       · LOTE y RES apuntan al mismo animal            → se liga.
//       · el documento trae solo uno de los dos, con un
//         único animal                                  → se liga, con aviso para confirmar.
//       · trae los dos y uno no aparece en la base      → queda SIN animal, con aviso.
//       · las Observaciones nombran varios LOTE o RES   → queda SIN animal (cubre varios animales).
//       · varios candidatos o LOTE y RES no coinciden   → queda SIN animal, con los candidatos en
//                                                         el aviso; se liga a mano. Nunca se adivina.
//   - Equivalencias de código conocidas (25000 ↔ 22229, 25002 ↔ 11163) se anotan en la línea; un
//     código que no está en el catálogo es solo un aviso (el documento es de la planta).

const { marcas, fmtFechaSql, fechaTexto, documentosDelTexto } = require('../comun');
const { parsearDocumentoCustodia, TIPOS } = require('../custodiaCiisaTexto');
const { EQUIVALENCIAS_CUSTODIA } = require('../../../data/catalogo-ciisa');

const DOCUMENTO_PEGADO = 'Texto pegado';
const INICIO_DOC = /CENTRO INTERNACIONAL DE INVERSIONES/i;
const VENTANA_DIAS = 180;
const corta = (v, n) => (v == null || v === '' ? null : String(v).slice(0, n));
const restarDias = (iso, dias) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10);
};

/** Animal del documento por Lote CC y RES (ver la cabecera). Devuelve { animal, avisos }. */
async function ligarAnimal(conn, doc) {
  // varios_animales: el aviso ya viene del parser (custodiaCiisaTexto.loteYRes).
  if (!doc.fecha || doc.varios_animales || (doc.lote_cc == null && !doc.res)) return { animal: null, avisos: [] };
  const desde = restarDias(doc.fecha, VENTANA_DIAS);
  let porLote = [];
  let porRes = [];
  if (doc.lote_cc != null) {
    [porLote] = await conn.query(
      `SELECT l.animal_id AS id, a.numero_trazabilidad AS arete, ${fmtFechaSql('l.fecha_deshuese', 'fecha')}
       FROM lotes_cc_aretes l JOIN animales a ON a.id = l.animal_id
       WHERE l.lote_cc = ? AND l.fecha_deshuese BETWEEN ? AND ? ORDER BY l.fecha_deshuese DESC`, [doc.lote_cc, desde, doc.fecha]);
  }
  if (doc.res) {
    [porRes] = await conn.query(
      `SELECT s.animal_id AS id, a.numero_trazabilidad AS arete, ${fmtFechaSql('s.fecha_dia', 'fecha')}
       FROM sacrificios s JOIN animales a ON a.id = s.animal_id
       WHERE s.numero_canal = ? AND s.fecha_dia BETWEEN ? AND ? ORDER BY s.fecha_dia DESC`, [doc.res, desde, doc.fecha]);
  }
  const lista = (xs) => xs.map((x) => `${x.arete} (${fechaTexto(x.fecha)})`).join(', ');
  const lote = `lote CC ${doc.lote_cc}`;
  const res = `RES ${doc.res}`;
  if (porLote.length && porRes.length) {
    const comun = porRes.filter((r) => porLote.some((l) => l.id === r.id));
    if (comun.length === 1) return { animal: comun[0], avisos: [] };
    return { animal: null, avisos: [`Sin animal: el ${lote} (${lista(porLote)}) y la ${res} (${lista(porRes)}) no coinciden en un solo animal; lígelo a mano`] };
  }
  // Si el documento trae LOTE y RES y solo uno se encuentra, el otro dato contradice o no confirma
  // el vínculo (p. ej. un lote de otro deshuese con el mismo número): no se liga por el que sí
  // apareció. Ligar por un solo dato queda para cuando el otro NO viene en el documento.
  if (doc.lote_cc != null && doc.res && (porLote.length || porRes.length)) {
    const falta = porLote.length ? `la ${res} no aparece en los sacrificios` : `el ${lote} no aparece en los deshueses`;
    const hallado = porLote.length ? `el ${lote} (${lista(porLote)})` : `la ${res} (${lista(porRes)})`;
    return { animal: null, avisos: [`Sin animal: el documento trae ${lote} y ${res}, pero ${falta}; se encontró ${hallado}. Lígelo a mano`] };
  }
  const solo = porLote.length ? porLote : porRes;
  const cual = porLote.length ? lote : res;
  const otro = porLote.length ? 'sin RES' : 'sin LOTE';
  if (solo.length === 1) return { animal: solo[0], avisos: [`Ligado solo por el ${cual} (${otro}): confírmelo`] };
  if (solo.length > 1) return { animal: null, avisos: [`Sin animal: el ${cual} corresponde a varios animales en los últimos ${VENTANA_DIAS} días (${lista(solo)}); lígelo a mano`] };
  const pedido = [doc.lote_cc != null ? lote : null, doc.res ? res : null].filter(Boolean).join(' / ');
  return { animal: null, avisos: [`Sin animal: no hay deshuese ni sacrificio registrado con ${pedido} en los ${VENTANA_DIAS} días antes del ${fechaTexto(doc.fecha)}`] };
}

const CAMPOS = [
  ['fecha_hora', 'Fecha'], ['bodega_origen_codigo', 'Bodega origen'], ['bodega_origen_nombre', 'Nombre bodega origen'],
  ['bodega_destino_codigo', 'Bodega destino'], ['bodega_destino_nombre', 'Nombre bodega destino'], ['estado', 'Estado'],
  ['observaciones', 'Observaciones'], ['lote_cc', 'Lote CC'], ['res', 'RES'], ['total_cajas_declarado', 'Unidades (total impreso)'],
  ['total_kg_declarado', 'Peso (total impreso)'],
];

async function planificar(conn, _tabla, _opciones, { lectura }) {
  const filas = [];
  const documentos = [];
  const leidos = [];
  for (const doc of lectura.documentos) {
    const nombre = doc.pegado ? DOCUMENTO_PEGADO : doc.nombre;
    if (doc.requiereVision) {
      filas.push({ fila: 1, documento: nombre, entidad: 'documento_custodia', clave: nombre, accion: 'error', errores: ['El PDF no trae texto (es una imagen escaneada): use «Cargar por foto»'], avisos: [] });
      continue;
    }
    // Varias fotos leídas seguidas pueden traer varios documentos: cada uno empieza en el membrete de
    // CIISA; la página 2 del mismo documento se une por tipo + número.
    const partes = documentosDelTexto(doc.texto, INICIO_DOC, parsearDocumentoCustodia, (d) => (d.tipo && d.numero ? `${d.tipo}|${d.numero}` : null));
    for (const d of partes) leidos.push({ doc, nombre, seg: `${nombre}#${leidos.length}`, d });
  }

  const claves = leidos.filter((l) => l.d.tipo && l.d.numero);
  let previos = [];
  let lineasPrevias = [];
  if (claves.length) {
    [previos] = await conn.query(
      `SELECT d.id, d.tipo, d.numero, DATE_FORMAT(d.fecha, '%Y-%m-%d %H:%i:%s') AS fecha_hora, d.bodega_origen_codigo, d.bodega_origen_nombre,
              d.bodega_destino_codigo, d.bodega_destino_nombre, d.estado, d.observaciones, d.lote_cc, d.res, d.animal_id, d.vinculo,
              d.total_cajas_declarado, d.total_kg_declarado, a.numero_trazabilidad AS arete
       FROM documentos_custodia d LEFT JOIN animales a ON a.id = d.animal_id
       WHERE ${claves.map(() => '(d.tipo = ? AND d.numero = ?)').join(' OR ')}`, claves.flatMap((l) => [l.d.tipo, l.d.numero]));
    if (previos.length) {
      [lineasPrevias] = await conn.query(
        `SELECT documento_id, orden, codigo, descripcion, cajas, kg FROM documentos_custodia_lineas
         WHERE documento_id IN (${marcas(previos.length)}) ORDER BY documento_id, orden`, previos.map((p) => p.id));
    }
  }
  const codigos = [...new Set(leidos.flatMap((l) => l.d.lineas.map((x) => x.codigo)))];
  let enCatalogo = new Set();
  if (codigos.length) {
    const [rows] = await conn.query(`SELECT codigo FROM catalogo_cortes WHERE codigo IN (${marcas(codigos.length)})`, codigos);
    enCatalogo = new Set(rows.map((r) => r.codigo));
  }

  const vistos = new Map();
  for (const { doc, nombre, seg, d } of leidos) {
    const errores = [];
    if (!d.tipo) errores.push('No se reconoce el documento: debe decir «AJUSTE DE SALIDA EN CUSTODIA» o «TRASLADO DE INVENTARIO EN CUSTODIA»');
    if (!d.numero) errores.push('No se encontró el número del documento (No. …)');
    if (!d.fecha) errores.push('No se encontró la fecha del documento');
    if (!d.lineas.length) errores.push('No se encontró ningún artículo (código de 5 dígitos con su peso)');
    const tipoInfo = d.tipo ? TIPOS[d.tipo] : null;
    const clave = d.tipo && d.numero ? `${tipoInfo.corto} ${d.numero}` : nombre;
    if (vistos.has(clave) && d.tipo && d.numero) errores.push(`El ${clave} viene dos veces en esta tanda (también en «${vistos.get(clave)}»)`);
    vistos.set(clave, nombre);

    const previo = previos.find((p) => p.tipo === d.tipo && Number(p.numero) === d.numero) || null;
    const datos = {
      tipo: d.tipo, numero: d.numero, fecha_hora: d.fecha ? `${d.fecha} ${d.hora || '00:00:00'}` : null,
      bodega_origen_codigo: d.bodega_origen?.codigo || null, bodega_origen_nombre: corta(d.bodega_origen?.nombre, 100),
      bodega_destino_codigo: d.bodega_destino?.codigo || null, bodega_destino_nombre: corta(d.bodega_destino?.nombre, 100),
      estado: corta(d.estado, 30), observaciones: corta(d.observaciones, 500), lote_cc: d.lote_cc, res: corta(d.res, 10),
      total_cajas_declarado: d.total_cajas, total_kg_declarado: d.total_kg,
    };
    const documento = {
      clave, documento: nombre, seg, tipo_texto: tipoInfo ? tipoInfo.nombre : 'Documento no reconocido', ...datos,
      total_cajas: d.suma_cajas, total_kg: d.suma_kg, archivo_nombre: doc.pegado ? null : corta(doc.nombre, 255),
      documento_id: previo ? previo.id : null, accion: previo ? 'sin_cambios' : 'nuevo', cambios: [], avisos: [...d.avisos], errores,
      animal_id: null, arete: null, vinculo: null, lineas: d.lineas.length,
    };
    if (d.tipo === 'ajuste_salida' && datos.bodega_origen_codigo && datos.bodega_origen_codigo !== '107') {
      documento.avisos.push(`La bodega de origen es ${datos.bodega_origen_codigo}, no la 107 de custodia`);
    }

    if (previo && previo.vinculo === 'manual') {
      documento.animal_id = previo.animal_id; documento.arete = previo.arete; documento.vinculo = 'manual';
      documento.avisos.push(`Ligado a mano a ${previo.arete || 'otro animal'}: se respeta`);
    } else if (!errores.length) {
      const { animal, avisos } = await ligarAnimal(conn, d);
      documento.avisos.push(...avisos);
      if (animal) { documento.animal_id = animal.id; documento.arete = animal.arete; documento.vinculo = 'automatico'; }
    }

    if (previo) {
      for (const [campo, etiqueta] of CAMPOS) {
        const antes = previo[campo] == null ? null : String(previo[campo]);
        let despues = datos[campo] == null ? null : String(datos[campo]);
        if (antes != null && despues != null && /^-?\d+(\.\d+)?$/.test(antes) && /^-?\d+(\.\d+)?$/.test(despues)) despues = Number(despues) === Number(antes) ? antes : despues;
        if (antes !== despues) documento.cambios.push({ campo, etiqueta, antes: previo[campo], despues: datos[campo] });
      }
      if (String(previo.animal_id ?? '') !== String(documento.animal_id ?? '')) documento.cambios.push({ campo: 'animal_id', etiqueta: 'Animal', antes: previo.arete, despues: documento.arete });
      const antes = lineasPrevias.filter((l) => l.documento_id === previo.id).map((l) => `${l.codigo}|${Number(l.cajas)}|${Number(l.kg)}`).join(';');
      const despues = d.lineas.map((l) => `${l.codigo}|${Number(l.cajas)}|${Number(l.kg)}`).join(';');
      if (antes !== despues) documento.cambios.push({ campo: 'lineas', etiqueta: 'Artículos', antes: `${lineasPrevias.filter((l) => l.documento_id === previo.id).length} línea(s)`, despues: `${d.lineas.length} línea(s)` });
      if (documento.cambios.length) documento.accion = 'actualizar';
    }
    if (errores.length) documento.accion = 'error';

    if (!d.lineas.length) {
      filas.push({ fila: 1, documento: nombre, entidad: 'documento_custodia', clave, accion: 'error', errores, avisos: [] });
    }
    for (const l of d.lineas) {
      const f = {
        fila: l.orden, documento: nombre, seg, entidad: 'custodia_linea', clave: `${clave} · ${l.codigo}`,
        orden: l.orden, codigo: l.codigo, codigo_equivalente: EQUIVALENCIAS_CUSTODIA[l.codigo] || null,
        descripcion: corta(l.descripcion, 150), unidad: corta(l.unidad, 10), cajas: l.cajas, kg: l.kg,
        accion: documento.accion === 'error' ? 'error' : documento.accion, errores: [...errores], avisos: [],
      };
      if (l.kg == null) f.errores.push(`No se leyó el peso del artículo ${l.codigo}`);
      else if (!(l.kg > 0) || l.kg > 5000) f.errores.push(`Peso ${l.kg} kg fuera de rango`);
      if (l.unidad_peso && /^LB/i.test(l.unidad_peso)) f.avisos.push('El peso viene en libras: revise que la columna leída sea la de kilos');
      if (!enCatalogo.has(l.codigo)) f.avisos.push(`El código ${l.codigo} no está en el catálogo de cortes`);
      if (f.codigo_equivalente) f.avisos.push(`Equivale al ${f.codigo_equivalente}`);
      if (f.errores.length) f.accion = 'error';
      filas.push(f);
    }
    // Un artículo ilegible frena todo el documento: guardar un traslado a medias descuadra los totales.
    if (documento.accion !== 'error' && filas.some((f) => f.seg === seg && f.accion === 'error')) {
      documento.accion = 'error';
      documento.errores.push('Hay artículos con error: corrija el texto y vuelva a ver la vista previa');
      for (const f of filas) if (f.seg === seg) { f.accion = 'error'; if (!f.errores.length) f.errores.push('El documento tiene artículos con error'); }
    }
    documentos.push(documento);
  }

  if (!filas.length) filas.push({ fila: 1, documento: null, entidad: 'documento_custodia', clave: '', accion: 'error', errores: ['No se pudo leer ningún documento'], avisos: [] });
  return { filas, documentos, errores_generales: [], resumen: { documentos: documentos.filter((x) => x.accion !== 'error').length } };
}

async function aplicar(conn, plan, { importacionId, usuarioId, registrar }) {
  const res = { documentos_nuevos: 0, documentos_actualizados: 0, lineas: 0, ligados: 0, documentos: [] };
  for (const d of plan.documentos) {
    if (d.accion === 'error') continue;
    const lineas = plan.filas.filter((f) => f.entidad === 'custodia_linea' && f.seg === d.seg);
    let id = d.documento_id;
    const valores = [d.fecha_hora, d.bodega_origen_codigo, d.bodega_origen_nombre, d.bodega_destino_codigo, d.bodega_destino_nombre, d.estado,
      d.observaciones, d.lote_cc, d.res, d.animal_id, d.animal_id ? d.vinculo : null, d.total_cajas, d.total_kg, d.total_cajas_declarado, d.total_kg_declarado];
    if (!id) {
      const [r] = await conn.query(
        `INSERT INTO documentos_custodia (tipo, numero, fecha, bodega_origen_codigo, bodega_origen_nombre, bodega_destino_codigo, bodega_destino_nombre,
           estado, observaciones, lote_cc, res, animal_id, vinculo, total_cajas, total_kg, total_cajas_declarado, total_kg_declarado,
           archivo_nombre, importacion_id, creado_por)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [d.tipo, d.numero, ...valores, d.archivo_nombre, importacionId, usuarioId || null]);
      id = r.insertId;
      res.documentos_nuevos++;
      registrar(null, 'documento_custodia', id, 'creado', { documento: d.clave, animal: d.arete });
    } else if (d.accion === 'actualizar') {
      // Un ligue manual no se pisa (la vista previa ya lo respetó; la base lo vuelve a revisar).
      await conn.query(
        `UPDATE documentos_custodia SET fecha = ?, bodega_origen_codigo = ?, bodega_origen_nombre = ?, bodega_destino_codigo = ?, bodega_destino_nombre = ?,
           estado = ?, observaciones = ?, lote_cc = ?, res = ?,
           animal_id = IF(vinculo = 'manual', animal_id, ?), vinculo = IF(vinculo = 'manual', vinculo, ?),
           total_cajas = ?, total_kg = ?, total_cajas_declarado = ?, total_kg_declarado = ?,
           archivo_nombre = COALESCE(?, archivo_nombre), importacion_id = ?
         WHERE id = ?`, [...valores, d.archivo_nombre, importacionId, id]);
      await conn.query('DELETE FROM documentos_custodia_lineas WHERE documento_id = ?', [id]);
      res.documentos_actualizados++;
      registrar(null, 'documento_custodia', id, 'actualizado', { documento: d.clave, cambios: d.cambios });
    } else {
      registrar(null, 'documento_custodia', id, 'sin_cambios', { documento: d.clave });
      res.documentos.push({ id, clave: d.clave });
      continue;
    }
    if (lineas.length) {
      await conn.query(
        'INSERT INTO documentos_custodia_lineas (documento_id, orden, codigo, codigo_equivalente, descripcion, unidad, cajas, kg) VALUES ?',
        [lineas.map((l) => [id, l.orden, l.codigo, l.codigo_equivalente, l.descripcion, l.unidad, l.cajas, l.kg])]);
      res.lineas += lineas.length;
    }
    if (d.animal_id) res.ligados++;
    res.documentos.push({ id, clave: d.clave });
  }
  return { resumen: res, documentos: res.documentos };
}

module.exports = { planificar, aplicar, ligarAnimal };
