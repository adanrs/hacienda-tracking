// Word (.docx) en el importador, guía de movilización del MAG (FTZ-02) y documentos de custodia de
// CIISA (ASE / TRE): lectores puros y planificación con una conexión simulada (sin MySQL).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { crearDocx } = require('./util-docx');
const { leerArchivo, desdeDocxXml, MENSAJE_DOC } = require('../src/lib/importador/archivos');
const { parsearGuiaMovilizacion, claveChip, sexoRaza, fechaGuia, horaGuia } = require('../src/lib/importador/guiaMovilizacionTexto');
const { parsearDocumentoCustodia, lineaArticulo, loteYRes } = require('../src/lib/importador/custodiaCiisaTexto');
const { partirDocumentos } = require('../src/lib/importador/comun');
const { formato } = require('../src/lib/importador/formatos');
const motor = require('../src/lib/importador/motor');
const vision = require('../src/lib/vision');

const FIX = path.join(__dirname, 'fixtures');
const leer = (n) => fs.readFileSync(path.join(FIX, n), 'utf8');

// ── Word (.docx) ─────────────────────────────────────────────────────────────

test('docx: tablas → hojas, párrafos → textos, texto corrido por tabulador', async () => {
  const buf = await crearDocx([
    'Sacrificio Wagyu 15-10-26',
    [['Codigo', 'Descripcion'], ['22229', 'CH-CHUCK RES'], ['11163', 'BEEF TRIMMINGS & más']],
    'Saludos',
  ]);
  const r = await leerArchivo(buf, 'listado.docx');
  assert.equal(r.hojas.length, 1);
  assert.deepEqual(r.hojas[0].filas, [['Codigo', 'Descripcion'], ['22229', 'CH-CHUCK RES'], ['11163', 'BEEF TRIMMINGS & más']]);
  assert.deepEqual(r.textos, ['Sacrificio Wagyu 15-10-26', 'Saludos']);
  assert.equal(r.texto, 'Sacrificio Wagyu 15-10-26\nCodigo\tDescripcion\n22229\tCH-CHUCK RES\n11163\tBEEF TRIMMINGS & más\nSaludos');
});

test('docx: celda con varios párrafos y tabla anidada se aplanan dentro de la celda', () => {
  const xml = '<w:body><w:tbl><w:tr><w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc>'
    + '<w:tc><w:tbl><w:tr><w:tc><w:p><w:r><w:t>x</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>y</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:tc></w:tr></w:tbl>'
    + '<w:p><w:r><w:t>uno</w:t><w:tab/><w:t>dos</w:t></w:r></w:p><w:p/></w:body>';
  const r = desdeDocxXml(xml);
  assert.equal(r.hojas.length, 1);
  assert.deepEqual(r.hojas[0].filas, [['A\nB', 'x y']]);
  assert.deepEqual(r.textos, ['uno\tdos']);
});

test('docx: el importador de tablas (catálogo) lee la tabla del Word igual que un Excel', async () => {
  const buf = await crearDocx(['Listado de cortes', [['Codigo', 'Descripcion', 'Tipo'], ['22229', 'CH-CHUCK RES', 'trimming']]]);
  const conn = { query: async () => [[]] };
  const plan = await motor.planificar(conn, 'catalogo-cortes', { archivo: { buffer: buf, nombre: 'cortes.docx' } });
  assert.equal(plan.filas.length, 1);
  assert.equal(plan.filas[0].clave, '22229');
  assert.equal(plan.filas[0].accion, 'nuevo');
});

test('docx: los formatos donde tiene sentido lo aceptan; los libros de Excel crudos no', () => {
  for (const id of ['ganadero-sg', 'sacrificio-ciisa', 'marmoleo-camara', 'reporte-produccion-ciisa', 'catalogo-cortes', 'guia-movilizacion', 'custodia-ciisa']) {
    assert.ok(formato(id).extensiones.includes('docx'), id);
  }
  for (const id of ['solicitud-deshuese-excel', 'inventario-ciisa']) assert.ok(!formato(id).extensiones.includes('docx'), id);
});

test('docx: un .doc viejo da el mensaje claro (también renombrado a .docx)', async () => {
  await assert.rejects(leerArchivo(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0]), 'guia.doc'), { message: MENSAJE_DOC });
  await assert.rejects(leerArchivo(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0]), 'guia.docx'), { message: MENSAJE_DOC });
  const conn = { query: async () => [[]] };
  await assert.rejects(motor.planificar(conn, 'catalogo-cortes', { archivo: { buffer: Buffer.from([0xd0, 0xcf, 0, 0]), nombre: 'cortes.doc' } }),
    (e) => e.status === 400 && /guárdelo como \.docx/.test(e.message));
  // Donde no se acepta Word, el .doc recibe la lista normal de extensiones.
  await assert.rejects(motor.planificar(conn, 'inventario-ciisa', { archivo: { buffer: Buffer.from([0xd0, 0xcf, 0, 0]), nombre: 'inv.doc' } }),
    (e) => e.status === 400 && /acepta/.test(e.message));
});

test('docx: un zip que no es Word o sin texto se rechaza con mensaje', async () => {
  await assert.rejects(leerArchivo(Buffer.from('hola'), 'x.docx'), /no es un Word/);
  const vacio = await crearDocx([]);
  await assert.rejects(leerArchivo(vacio, 'x.docx'), /no trae texto/);
});

test('docx: un document.xml inflado (más de 10 MB al descomprimir) se corta sin leerlo entero', async () => {
  const JSZip = require('jszip');
  const zip = new JSZip();
  zip.file('word/document.xml', `<w:body><w:p><w:r><w:t>${'a'.repeat(11 * 1024 * 1024)}</w:t></w:r></w:p></w:body>`);
  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  assert.ok(buf.length < 100 * 1024, 'comprimido pesa poco');
  await assert.rejects(leerArchivo(buf, 'bomba.docx'), /demasiado grande/);
});

// ── Guía de movilización del MAG ─────────────────────────────────────────────

test('guía MAG: lee el texto real del PDF EH0204095 (pdf-parse)', () => {
  const g = parsearGuiaMovilizacion(leer('guia-movilizacion-EH0204095.txt'));
  assert.equal(g.numero, 'EH0204095');
  assert.equal(g.fecha, '2026-10-15');
  assert.equal(g.hora, '07:20');
  assert.equal(g.autorizacion, 'HJ150FQ0FA');
  assert.equal(g.origen.nombre, 'HACIENDA TEMPISQUE S.A.');
  assert.equal(g.origen.cue, '1880501049214');
  assert.equal(g.destino.establecimiento, 'CIISA-EL ARREO-ESTABLECIMIENTO 12 (BOVINOS)');
  assert.equal(g.destino.cue, '1880407003516');
  assert.equal(g.transportista, 'Juan Pérez Mora');
  assert.equal(g.conductor, 'PEDRO SOLIS ROJAS');
  assert.equal(g.placa, 'C 175410');
  assert.equal(g.total_bovinos, 7);
  assert.equal(g.animales.length, 7);
  assert.deepEqual(g.animales[0], { orden: 1, diio: '188001057994', sexo: 'H', raza: 'Cruza Brahman' });
  assert.deepEqual(g.animales[1], { orden: 2, diio: '188001058015', sexo: 'MC', raza: 'Cruza Wagyu' });
  assert.ok(!g.animales.some((a) => a.diio === '1880501049214'), 'el CUE no es un animal');
  assert.deepEqual(g.avisos, []);
});

test('guía MAG: el texto de la lectura por foto (etiquetas y tabulador) da lo mismo', () => {
  const t = 'SERVICIO NACIONAL DE SALUD ANIMAL\nNo.: EH0204095\nFecha: 15/10/2026\nHora: 07:20 a. m.\nOrigen: HACIENDA TEMPISQUE S.A.\n'
    + 'Establecimiento origen: HACIENDA TEMPISQUE S.A.\nCUE origen: 1880501049214\nDestino: CENTRO INTERNACIONAL DE INVERSIONES CII S.A.\n'
    + 'Establecimiento destino: CIISA-EL ARREO-ESTABLECIMIENTO 12 (BOVINOS)\nCUE destino: 1880407003516\nPlaca: C 175410\nBovinos: 3\nDIIO\n'
    + '1\t188001057994\tH\tCruza Brahman\n2\t188001058015\tMC\tCruza Wagyu\n3\t188001058064\tH\tCruza Brahman';
  const g = parsearGuiaMovilizacion(t);
  assert.equal(g.numero, 'EH0204095');
  assert.equal(g.fecha, '2026-10-15');
  assert.equal(g.origen.cue, '1880501049214');
  assert.equal(g.destino.establecimiento, 'CIISA-EL ARREO-ESTABLECIMIENTO 12 (BOVINOS)');
  assert.equal(g.placa, 'C 175410');
  assert.deepEqual(g.animales.map((a) => `${a.orden}:${a.diio}:${a.sexo}`), ['1:188001057994:H', '2:188001058015:MC', '3:188001058064:H']);
});

test('guía MAG: avisa si la cantidad declarada no calza con las filas leídas', () => {
  const g = parsearGuiaMovilizacion('No. EH0000001\nFecha: 01/11/2026\nBovinos: 3\nDIIO\n1\t188001057994\tH\tCruza');
  assert.equal(g.animales.length, 1);
  assert.match(g.avisos[0], /dice 3 bovino/);
});

test('guía MAG: sexo pegado a la raza, fechas con mes en letras y hora con a. m. / p. m.', () => {
  assert.deepEqual(sexoRaza('HCruza Brahman'), { sexo: 'H', raza: 'Cruza Brahman' });
  assert.deepEqual(sexoRaza('MCCruza Wagyu'), { sexo: 'MC', raza: 'Cruza Wagyu' });
  assert.deepEqual(sexoRaza('MCruza Wagyu'), { sexo: 'M', raza: 'Cruza Wagyu' });
  assert.deepEqual(sexoRaza('MC'), { sexo: 'MC', raza: null });
  assert.equal(fechaGuia('15/oct./2026'), '2026-10-15');
  assert.equal(fechaGuia('3/set./2026'), '2026-09-03');
  assert.equal(fechaGuia('31/02/2026'), null);
  assert.equal(horaGuia('2:05 p. m.'), '14:05');
  assert.equal(horaGuia('12:10 a. m.'), '00:10');
});

test('guía MAG: el DIIO de la guía y la I.E. de Ganadero SG dan la misma clave', () => {
  assert.equal(claveChip('188001057994'), '188:1057994');
  assert.equal(claveChip('A0020000188000001057994'), '188:1057994');
  assert.equal(claveChip('A002 0000-1880 0000 1057994'), '188:1057994');
  assert.notEqual(claveChip('A0020000188000001057859'), claveChip('188001057994'));
  assert.equal(claveChip(''), null);
});

/** Conexión simulada: responde según el SQL (solo lo que usan los procesadores nuevos). */
function connSimulada({ animales = [], guiasTransporte = [], guias = [], lineasGuia = [], lotes = [], canales = [], catalogo = [], docs = [] } = {}) {
  return {
    sql: [],
    async query(sql, params = []) {
      this.sql.push(sql);
      if (/FROM animales\s+WHERE .*identificacion_electronica LIKE/s.test(sql)) {
        return [animales.filter((a) => params.some((p) => a.identificacion_electronica.endsWith(p.slice(1))))];
      }
      if (/FROM guias_movilizacion WHERE numero IN/.test(sql)) return [guias.filter((g) => params.includes(g.numero))];
      if (/FROM guia_movilizacion_animales l LEFT JOIN animales/.test(sql)) return [lineasGuia];
      if (/FROM guias_transporte gt JOIN guia_transporte_animales/.test(sql)) return [guiasTransporte];
      if (/FROM lotes_cc_aretes l JOIN animales/.test(sql)) return [lotes.filter((l) => l.lote_cc === params[0] && l.fecha >= params[1] && l.fecha <= params[2])];
      if (/FROM sacrificios s JOIN animales/.test(sql)) return [canales.filter((c) => c.canal === params[0] && c.fecha >= params[1] && c.fecha <= params[2])];
      if (/FROM catalogo_cortes WHERE codigo IN/.test(sql)) return [catalogo.filter((c) => params.includes(c)).map((codigo) => ({ codigo }))];
      if (/FROM documentos_custodia d LEFT JOIN animales/.test(sql)) return [docs];
      return [[]];
    },
  };
}

const ANIMAL_1 = { id: 11, numero_trazabilidad: '225MLE', identificacion_electronica: 'A0020000188000001057994', sexo: 'hembra', estado: 'activo' };
const ANIMAL_2 = { id: 12, numero_trazabilidad: '33FLE', identificacion_electronica: 'A0020000188000001058015', sexo: 'macho', estado: 'activo' };

test('guía MAG: vista previa liga por I.E. y deja «sin animal» lo que no calza (sin inventar)', async () => {
  const conn = connSimulada({
    animales: [ANIMAL_1, ANIMAL_2],
    guiasTransporte: [{ id: 5, numero: 'GT-20261015-001', guia_movilizacion: null, fecha: '2026-10-15', animal_id: 11, transporte_id: 91 }],
  });
  const plan = await motor.planificar(conn, 'guia-movilizacion', { pegado: { texto: leer('guia-movilizacion-EH0204095.txt') } });
  assert.equal(plan.guias.length, 1);
  const g = plan.guias[0];
  assert.equal(g.numero, 'EH0204095');
  assert.equal(g.accion, 'nuevo');
  assert.equal(g.ligados, 2);
  assert.deepEqual(g.guias_transporte.map((x) => x.numero), ['GT-20261015-001']);
  const filas = plan.filas.filter((f) => f.entidad === 'guia_movilizacion_animal');
  assert.equal(filas.length, 7);
  assert.equal(filas[0].arete, '225MLE');
  assert.equal(filas[1].arete, '33FLE');
  const sin = filas.filter((f) => !f.animal_id);
  assert.equal(sin.length, 5);
  assert.ok(sin.every((f) => f.accion === 'nuevo' && f.avisos.some((a) => /Sin animal/.test(a))));
  assert.equal(plan.resumen.sin_animal, 5);
  // Toda consulta va con parámetros: el DIIO nunca se pega al SQL.
  assert.ok(conn.sql.every((s) => !s.includes('1057994')));
});

test('guía MAG: dos animales con la misma clave de chip → sin animal (ambiguo)', async () => {
  const otro = { ...ANIMAL_2, id: 13, numero_trazabilidad: 'DUP1', identificacion_electronica: '188001057994' };
  const conn = connSimulada({ animales: [ANIMAL_1, otro] });
  const plan = await motor.planificar(conn, 'guia-movilizacion', { pegado: { texto: 'No. EH0000001\nFecha: 01/11/2026\nDIIO\n1\t188001057994\tH\tCruza' } });
  const f = plan.filas[0];
  assert.equal(f.animal_id, null);
  assert.equal(f.accion, 'nuevo', 'se guarda sin animal, no es error');
  assert.match(f.avisos.join(' '), /2 animales tienen esta I\.E\./);
});

test('guía MAG: sin número o PDF escaneado → error claro', async () => {
  const conn = connSimulada();
  const p1 = await motor.planificar(conn, 'guia-movilizacion', { pegado: { texto: 'DIIO\n1\t188001057994\tH\tCruza' } });
  assert.ok(p1.filas.every((f) => f.accion === 'error'));
  assert.match(p1.filas[0].errores.join(' '), /número de la guía/);
});

test('guía MAG: un ligue a mano no se pisa al re-importar', async () => {
  const conn = connSimulada({
    animales: [ANIMAL_1],
    guias: [{ id: 3, numero: 'EH0000001', fecha: '2026-11-01', hora: null, autorizacion: null, origen_nombre: null, origen_establecimiento: null, origen_cue: null, destino_nombre: null, destino_establecimiento: null, destino_cue: null, transportista: null, placa: null, conductor: null, total_declarado: null }],
    lineasGuia: [{ guia_id: 3, diio: '188001057994', orden: 1, sexo: 'H', raza: 'Cruza', animal_id: 77, vinculo: 'manual', numero_trazabilidad: 'MANUAL' }],
  });
  const plan = await motor.planificar(conn, 'guia-movilizacion', { pegado: { texto: 'No. EH0000001\nFecha: 01/11/2026\nDIIO\n1\t188001057994\tH\tCruza' } });
  const f = plan.filas[0];
  assert.equal(f.animal_id, 77);
  assert.equal(f.vinculo, 'manual');
  assert.equal(f.accion, 'sin_cambios');
  assert.equal(plan.guias[0].accion, 'sin_cambios');
});

test('guía MAG: varias fotos leídas seguidas = varias guías; la página 2 se une a la 1', () => {
  const pag = (n, diio) => `SERVICIO NACIONAL DE SALUD ANIMAL\nNo.: ${n}\nFecha: 01/11/2026\nDIIO\n1\t${diio}\tH\tCruza`;
  const partes = partirDocumentos(`${pag('EH0000001', '188001057994')}\n${pag('EH0000002', '188001058015')}`, /SERVICIO NACIONAL DE SALUD ANIMAL/i);
  assert.equal(partes.length, 2);
  const { documentosDelTexto } = require('../src/lib/importador/comun');
  const docs = documentosDelTexto(`${pag('EH0000001', '188001057994')}\nSERVICIO NACIONAL DE SALUD ANIMAL\nNo.: EH0000001\n${pag('EH0000002', '188001058015')}`,
    /SERVICIO NACIONAL DE SALUD ANIMAL/i, parsearGuiaMovilizacion, (g) => g.numero);
  assert.deepEqual(docs.map((d) => d.numero), ['EH0000001', 'EH0000002']);
});

test('guía MAG: el .docx de la guía pasa por el mismo lector', async () => {
  const buf = await crearDocx([
    'FORMULARIO DE TRAZABILIDAD FTZ-02', 'No. EH0204095', 'FECHA', '15/oct./2026',
    'DISPOSITIVOS DE IDENTIFICACIÓN INDIVIDUAL',
    [['#', 'OFICIAL (DIIO)', 'CUMPLE', 'SEXO', 'RAZA'], ['1', '188001057994', 'ü', 'H', 'Cruza Brahman'], ['2', '188001058015', 'ü', 'MC', 'Cruza Wagyu']],
  ]);
  const conn = connSimulada({ animales: [ANIMAL_1] });
  const plan = await motor.planificar(conn, 'guia-movilizacion', { archivo: { buffer: buf, nombre: 'EH0204095.docx' } });
  assert.equal(plan.guias[0].numero, 'EH0204095');
  assert.equal(plan.guias[0].fecha, '2026-10-15');
  const filas = plan.filas.filter((f) => f.entidad === 'guia_movilizacion_animal');
  assert.deepEqual(filas.map((f) => [f.diio, f.sexo, f.raza, f.arete]), [['188001057994', 'H', 'Cruza Brahman', '225MLE'], ['188001058015', 'MC', 'Cruza Wagyu', null]]);
});

// ── Documentos de custodia CIISA ─────────────────────────────────────────────

test('custodia: ASE 353 (ajuste de salida) con observaciones y totales', () => {
  const d = parsearDocumentoCustodia(leer('custodia-ajuste-353.txt'));
  assert.equal(d.tipo, 'ajuste_salida');
  assert.equal(d.numero, 353);
  assert.deepEqual(d.bodega_origen, { codigo: '107', nombre: 'EQTB TEMPISQUE' });
  assert.equal(d.bodega_destino, null);
  assert.equal(d.fecha, '2024-03-26');
  assert.equal(d.hora, '14:03:07');
  assert.equal(d.observaciones, 'AUTORIZA JUAN CARLOS GILLEN, PRODUCTO PARA ZAMU');
  assert.equal(d.lote_cc, null);
  assert.deepEqual(d.lineas.map((l) => [l.codigo, l.descripcion, l.cajas, l.kg]), [['25000', 'BCH WAGYU', 14, 381.08], ['25002', 'TRIMMING WAGYU', 9, 244.98]]);
  assert.equal(d.total_kg, 626.06);
  assert.deepEqual(d.avisos, []);
});

test('custodia: TRE 1824 (traslado) saca LOTE 35 y RES 5094 y avisa que faltan líneas', () => {
  const d = parsearDocumentoCustodia(leer('custodia-traslado-1824.txt'));
  assert.equal(d.tipo, 'traslado');
  assert.equal(d.numero, 1824);
  assert.deepEqual(d.bodega_destino, { codigo: '08', nombre: 'PAQUETERIA-MATERIA PRIMA' });
  assert.equal(d.fecha, '2026-04-24');
  assert.equal(d.estado, 'Listo');
  assert.equal(d.observaciones, 'CORTES FINOS LOTE 35 / RES 5094');
  assert.equal(d.lote_cc, 35);
  assert.equal(d.res, '5094');
  assert.equal(d.lineas.length, 5);
  assert.deepEqual(d.lineas[3], { orden: 4, codigo: '22228', descripcion: 'POSTA DE PECHO RRS.', unidad: 'CAJ', cajas: 1, unidad_peso: 'KGS', kg: 19.1 });
  assert.equal(d.total_cajas, 20);
  assert.equal(d.total_kg, 147.8);
  assert.equal(d.avisos.length, 2, 'la foto trae 5 de 20 cajas: falta otra página');
});

test('custodia: líneas pegadas por pdf-parse y observaciones con LOTE CC', () => {
  assert.deepEqual(lineaArticulo('25000BCH WAGYUCAJ14KGS381.08381.08'), { codigo: '25000', descripcion: 'BCH WAGYU', unidad: 'CAJ', cajas: 14, unidad_peso: 'KGS', kg: 381.08 });
  assert.equal(lineaArticulo('Articulo Descripcion'), null);
  assert.deepEqual(loteYRes('CORTES FINOS LOTE CC 06 / RES 5111'), { lote_cc: 6, res: '5111' });
  assert.deepEqual(loteYRes('PRODUCTO PARA ZAMU'), { lote_cc: null, res: null });
});

test('custodia: LOTE + RES del mismo animal → se liga; equivalencias 25000/25002 anotadas', async () => {
  const conn = connSimulada({
    lotes: [{ id: 21, arete: '177MFU', fecha: '2026-04-02', lote_cc: 35 }, { id: 22, arete: 'OTRO', fecha: '2026-03-01', lote_cc: 35 }],
    canales: [{ id: 21, arete: '177MFU', fecha: '2026-04-01', canal: '5094' }],
    catalogo: ['22140', '22219', '22224', '22228'],
  });
  const plan = await motor.planificar(conn, 'custodia-ciisa', { pegado: { texto: leer('custodia-traslado-1824.txt') } });
  const d = plan.documentos[0];
  assert.equal(d.clave, 'TRE 1824');
  assert.equal(d.accion, 'nuevo');
  assert.equal(d.animal_id, 21);
  assert.equal(d.arete, '177MFU');
  assert.ok(plan.filas.find((f) => f.codigo === '40141').avisos.some((a) => /no está en el catálogo/.test(a)));

  const ase = await motor.planificar(connSimulada(), 'custodia-ciisa', { pegado: { texto: leer('custodia-ajuste-353.txt') } });
  assert.equal(ase.documentos[0].animal_id, null);
  assert.deepEqual(ase.filas.map((f) => [f.codigo, f.codigo_equivalente]), [['25000', '22229'], ['25002', '11163']]);
});

test('custodia: solo LOTE con dos animales posibles → sin animal, con los candidatos', async () => {
  const conn = connSimulada({ lotes: [{ id: 21, arete: '177MFU', fecha: '2026-04-02', lote_cc: 35 }, { id: 22, arete: 'OTRO', fecha: '2026-03-01', lote_cc: 35 }] });
  const texto = leer('custodia-traslado-1824.txt').replace(' / RES 5094', '');
  const plan = await motor.planificar(conn, 'custodia-ciisa', { pegado: { texto } });
  const d = plan.documentos[0];
  assert.equal(d.animal_id, null);
  assert.match(d.avisos.join(' '), /varios animales.*177MFU.*OTRO/);
});

test('custodia: LOTE y RES que apuntan a animales distintos → sin animal', async () => {
  const conn = connSimulada({
    lotes: [{ id: 21, arete: '177MFU', fecha: '2026-04-02', lote_cc: 35 }],
    canales: [{ id: 30, arete: 'XYZ', fecha: '2026-04-01', canal: '5094' }],
  });
  const plan = await motor.planificar(conn, 'custodia-ciisa', { pegado: { texto: leer('custodia-traslado-1824.txt') } });
  assert.equal(plan.documentos[0].animal_id, null);
  assert.match(plan.documentos[0].avisos.join(' '), /no coinciden/);
});

test('custodia: dos documentos en el mismo texto (dos fotos leídas) son dos documentos', async () => {
  const texto = `${leer('custodia-ajuste-353.txt')}\n${leer('custodia-traslado-1824.txt')}`;
  const plan = await motor.planificar(connSimulada(), 'custodia-ciisa', { pegado: { texto } });
  assert.deepEqual(plan.documentos.map((d) => d.clave), ['ASE 353', 'TRE 1824']);
  assert.equal(plan.filas.filter((f) => f.entidad === 'custodia_linea').length, 7);
});

test('custodia: artículo sin peso frena el documento entero', async () => {
  const texto = 'CENTRO INTERNACIONAL DE INVERSIONES S.A\nAJUSTE DE SALIDA EN CUSTODIA\nNo. : 9\nFecha 01-11-2026 10:00:00\n25000 BCH WAGYU ilegible\n25002 TRIMMING WAGYU CAJ 9 KGS 244.98';
  const plan = await motor.planificar(connSimulada(), 'custodia-ciisa', { pegado: { texto } });
  assert.equal(plan.documentos[0].accion, 'error');
  assert.ok(plan.filas.every((f) => f.accion === 'error'));
});

test('custodia: el .docx con la tabla de artículos se lee', async () => {
  const buf = await crearDocx([
    'CENTRO INTERNACIONAL DE INVERSIONES S.A', 'TRASLADO DE INVENTARIO EN CUSTODIA', 'No. 1824',
    'Bodega de Origen : 107 EQTB TEMPISQUE', 'Bodega de Destino : 08 PAQUETERIA-MATERIA PRIMA', 'Fecha : 24-04-2026 16:04:48',
    'Observaciones: CORTES FINOS LOTE 35 / RES 5094',
    [['Articulo', 'Descripcion', 'Und.Alm.', 'Unidades', 'Und.Pes.', 'Peso'], ['22140', 'CESINA DE RES LIMPIA CP', 'CAJ', '1.00', 'KGS', '3.66']],
  ]);
  const plan = await motor.planificar(connSimulada(), 'custodia-ciisa', { archivo: { buffer: buf, nombre: 'TRE-1824.docx' } });
  const d = plan.documentos[0];
  assert.equal(d.clave, 'TRE 1824');
  assert.equal(d.lote_cc, 35);
  assert.deepEqual(plan.filas.map((f) => [f.codigo, f.cajas, f.kg]), [['22140', 1, 3.66]]);
});

test('foto: lo leído por foto en la guía y en custodia queda marcado para revisar', async () => {
  const conn = connSimulada();
  const plan = await motor.planificar(conn, 'guia-movilizacion', { pegado: { texto: 'No. EH0000001\nFecha: 01/11/2026\nDIIO\n1\t188001057994\tH\tCruza' } }, { foto: { dudosas: [] } });
  assert.equal(plan.filas[0].leido_por_foto, true);
  assert.equal(plan.filas[0].revisar_foto, true, 'sin animal = aviso: con foto se pide revisar');
});

test('vision: instrucciones de los formatos nuevos caben en el gateway (2000 caracteres)', () => {
  for (const id of ['guia-movilizacion', 'custodia-ciisa']) {
    assert.ok(vision.INSTRUCCIONES[id], id);
    assert.ok(vision.instruccionesDe(id).length <= 2000, id);
  }
});
