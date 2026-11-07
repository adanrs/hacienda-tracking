// Carga por foto: el texto que devuelve la visión (Nemotron VL, gateway /vision) pasa por el MISMO
// procesador que el archivo o el pegado, y la vista previa marca lo que hay que revisar.
//
// Fixtures «foto-*.txt»: salida REAL del modelo de visión (kiwi-vision en la VM Kiwi AI, mismo
// modelo y mismas instrucciones que lib/vision.js) sobre las fotos de la reunión del 05-nov-2026
// (D:\Claude-entregas\wagyu\notas-reunion-jc-2026-11-05). La del reporte de Ganadero SG trae errores
// de lectura reales (I.E. con un cero menos, «PG69» por «PG89»): justo lo que la vista previa debe hacer saltar.
// Inventario y solicitud de deshuese no tienen foto de ejemplo: el texto es el que piden sus instrucciones.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'secreto-solo-para-pruebas-0123456789abcdef';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const motor = require('../src/lib/importador/motor');
const { marcarLecturaFoto, dudosasDe, AVISO } = require('../src/lib/importador/foto');
const { revisarIEFoto } = require('../src/lib/importador/procesadores/ganaderoSg');
const deshuese = require('../src/lib/importador/procesadores/solicitudDeshueseExcel');
const inv = require('../src/lib/importador/procesadores/inventarioCiisa');
const { leerReportes } = require('../src/lib/importador/reporteCiisaTexto');
const vision = require('../src/lib/vision');

const FIX = path.join(__dirname, 'fixtures');
const leer = (n) => fs.readFileSync(path.join(FIX, n), 'utf8');
const FOTO = { foto: { dudosas: [] } };

// ── Conn falsos ──────────────────────────────────────────────────────────────
// Guía de transporte del 15-oct con los 6 animales del correo real (peso de salida del reporte de
// Ganadero SG; el de 177NFU no viene en esa foto); todo lo demás, vacío.
const PESO_SALIDA = { '225MLE': 660, '438MLF': 766, '81FLB': 748, '177NFU': 760, '33FLE': 714, '710FLF': 618 };
const GUIA = Object.keys(PESO_SALIDA).map((arete, i) => ({
  animal_id: 100 + i, arete, sexo: i >= 4 ? 'hembra' : 'macho', peso_salida_kg: PESO_SALIDA[arete], transporte_id: null,
  guia_id: 9, numero: 'GT-20261015-01', fecha_salida: '2026-10-15', numero_trazabilidad: arete,
}));
const connSacrificio = { async query(sql) { return [/FROM guia_transporte_animales/.test(sql) ? GUIA : []]; } };
const connVacio = { async query() { return [[]]; } };

test('instrucciones: cada formato que se carga por foto tiene las suyas y caben en el gateway (2000)', () => {
  for (const f of ['ganadero-sg', 'sacrificio-ciisa', 'solicitud-deshuese-excel', 'inventario-ciisa', 'marmoleo-camara', 'reporte-produccion-ciisa', 'catalogo-cortes']) {
    const i = vision.INSTRUCCIONES[f];
    assert.ok(i, f);
    assert.ok(i.length <= 2000, `${f}: ${i.length} caracteres`);
    assert.match(i, /\?\?/, `${f}: debe pedir «??» en lo ilegible`);
  }
  // Un formato sin instrucciones propias no cae en las del sacrificio (antes pasaba).
  assert.doesNotMatch(vision.instruccionesDe('otro'), /Sacrificio/);
});

test('sacrificio por foto (texto real de la visión): se lee igual que el correo y amarra con la guía', async () => {
  const texto = leer('foto-sacrificio-ciisa.txt');
  const plan = await motor.planificar(connSacrificio, 'sacrificio-ciisa', { pegado: { texto } }, FOTO);
  assert.equal(plan.fecha_sacrificio, '2026-10-15'); // del asunto «Sacrificio Wagyu 15-10-26»
  assert.equal(plan.filas.length, 6);
  assert.deepEqual(plan.filas.map((f) => f.arete), ['225MLE', '438MLF', '81FLB', '177NFU', '33FLE', '710FLF']);
  assert.equal(plan.resumen.errores, 0);
  assert.ok(plan.filas.every((f) => f.leido_por_foto));
  assert.equal(plan.leido_por_foto.filas_revisar, 0);
});

test('sacrificio por foto: un arete mal leído salta con la corrección de la guía y la marca «revisar»', async () => {
  // La visión confunde la E final con F y un dígito ilegible queda «??».
  const texto = leer('foto-sacrificio-ciisa.txt').replace('225MLE', '225MLF').replace('\t740\t', '\t7??\t');
  const plan = await motor.planificar(connSacrificio, 'sacrificio-ciisa', { pegado: { texto } }, { foto: { dudosas: ['225MLF'] } });
  const mal = plan.filas.find((f) => f.numero_canal === '5256');
  assert.equal(mal.accion, 'error');
  assert.equal(mal.correccion.propuesto, '225MLE'); // la misma validación de amarre del correo
  assert.ok(mal.revisar_foto);
  assert.ok(mal.avisos.includes(AVISO)); // venía en `dudosas`
  const ilegible = plan.filas.find((f) => f.numero_canal === '5257');
  assert.equal(ilegible.accion, 'error'); // «7??» no es un peso
  assert.ok(ilegible.revisar_foto);
  // El reporte para la planta advierte que puede ser un error de lectura.
  assert.match(plan.reporte_planta, /^\(Datos leídos de una foto/);
  // Sin `foto`, el mismo texto no lleva marcas (archivo o pegado normal).
  const normal = await motor.planificar(connSacrificio, 'sacrificio-ciisa', { pegado: { texto } }, {});
  assert.ok(normal.filas.every((f) => !f.leido_por_foto && !f.revisar_foto));
  assert.doesNotMatch(normal.reporte_planta, /foto/);
});

test('Ganadero SG por foto (texto real): metadatos, 5 animales y la I.E. mal leída salta', async () => {
  const texto = leer('foto-ganadero-sg.txt');
  const plan = await motor.planificar(connVacio, 'ganadero-sg', { pegado: { texto } }, { crear_guias: true, ...FOTO });
  assert.equal(plan.metadatos.finca, '01-003 - ENGORDE WAGYU');
  assert.equal(plan.filas.length, 5);
  assert.deepEqual(plan.filas.map((f) => f.numero), ['225MLE', '33FLE', '438MLF', '710FLF', '81FLB']);
  assert.equal(plan.resumen.errores, 0);
  // La visión leyó las 5 I.E. con 22 caracteres (la real tiene 23): cada fila va con aviso y «revisar».
  for (const f of plan.filas) {
    assert.ok(f.avisos.some((a) => /I\.E\..*22 caracteres.*mal leída de la foto/.test(a)), f.numero);
    assert.ok(f.revisar_foto, f.numero);
  }
  // Guía de transporte del 15-oct armada desde el mismo texto.
  assert.equal(plan.guias.length, 1);
  assert.equal(plan.guias[0].fecha_salida, '2026-10-15');
  assert.equal(plan.guias[0].total_animales, 5);
});

test('I.E. por foto: solo avisa las que no tienen 23 caracteres', () => {
  const filas = [{ v: { ie: 'A0020000188000001057859' }, avisos: [] }, { v: { ie: 'A002000018800001057859' }, avisos: [] }, { v: {}, avisos: [] }];
  revisarIEFoto(filas);
  assert.deepEqual(filas.map((f) => f.avisos.length), [0, 1, 0]);
});

test('reporte de producción por foto (texto real): un lote con 27 artículos y su pie', () => {
  const [r, ...resto] = leerReportes(leer('foto-reporte-produccion.txt'));
  assert.equal(resto.length, 0);
  assert.equal(r.lineas.length, 27);
  assert.deepEqual(r.pie, { lote: '2', libras: 773.42, kilos: 350.82, cajas: 31 });
});

test('inventario por foto: la tabla por tabulador entra por el lector del pegado', () => {
  const texto = [
    'Tarima\tLinea\tCod Barra\tCodigo\tDescripción\tPeso\tMedida\tLote\tFecha Vencimiento',
    '3\t1\t2661700446XXX290326003911\t26617\tNEW YORK STEAK\t4.46\tKilos\t2903260039\t29/06/2026',
    '3\t2\t2661700??6XXX290326003911\t26617\tNEW YORK STEAK\t4.4?\tKilos\t2903260039\t29/06/2026',
  ].join('\n');
  const r = inv.leerPegado(texto);
  assert.equal(r.hojas[0].tipo, 'general');
  const [bien, mal] = r.hojas[0].lineas;
  assert.equal(bien.peso, 4.46);
  assert.ok(mal.errores.length > 0); // peso ilegible = error de la línea, como en el Excel
  // Y el motor marca la línea con «??» para revisar.
  const plan = { filas: [{ fila: 1, codigo_barras: bien.codigo_barras, errores: [], avisos: [] }, { fila: 2, codigo_barras: mal.codigo_barras, errores: [], avisos: [] }] };
  marcarLecturaFoto(plan, FOTO);
  assert.deepEqual(plan.filas.map((f) => Boolean(f.revisar_foto)), [false, true]);
});

const TEXTO_DESHUESE = [
  'Deshuese 151026',
  'Canal #\tCanal # 1\tCanal # 2\tCanal # 3',
  'Arete\t225MLE\t438MLF\t81FLB',
  'Sexo\tM\tM\tM',
  'Peso canal\t378.5\t460\t420',
  'Consecutivo Mes Sacrificio\t5256\t5257\t5258',
  'Marble Score\t5\t6\t4',
  'Codigo',
  '22229\tCH-CHUCK\t2\t2\t2',
  '\tLomito (Cabeza)\t1\t0\t2',
  '22101\tLomito\t2\t2\t2',
].join('\n');

test('solicitud de deshuese por foto: el texto se vuelca a la misma hoja que el Excel', () => {
  const h = deshuese.hojaDesdeTexto(TEXTO_DESHUESE);
  assert.equal(h.nombre, 'Deshuese 151026');
  const l = deshuese.leerHoja(h.hoja);
  assert.deepEqual(l.canales.map((c) => [c.columna, c.arete, c.numero_canal, c.peso_canal, c.marmoleo]),
    [['G', '225MLE', '5256', 378.5, 5], ['I', '438MLF', '5257', 460, 6], ['K', '81FLB', '5258', 420, 4]]);
  assert.deepEqual(l.cortes.map((c) => [c.codigo, c.nombre, c.medias]), [
    ['22229', 'CH-CHUCK', { G: 2, I: 2, K: 2 }],
    [null, 'Lomito (Cabeza)', { G: 1, I: 0, K: 2 }],
    ['22101', 'Lomito', { G: 2, I: 2, K: 2 }],
  ]);
  // Seis canales o más: ninguna cae en la columna Q (observaciones del libro).
  const seis = deshuese.hojaDesdeTexto('Arete\ta\tb\tc\td\te\tf\nCodigo\n22229\tX\t1\t1\t1\t1\t1\t2');
  const l6 = deshuese.leerHoja(seis.hoja);
  assert.deepEqual(l6.canales.map((c) => c.columna), ['G', 'I', 'K', 'M', 'O', 'S']);
  assert.equal(l6.cortes[0].observacion, null);
  assert.equal(deshuese.hojaDesdeTexto('nada que ver'), null);
});

test('solicitud de deshuese por foto (motor): fecha del texto o de la pantalla, canales ligadas por n.º', async () => {
  const conn = {
    async query(sql) {
      if (/FROM sacrificios s JOIN animales a/.test(sql)) {
        return [[{ id: 1, animal_id: 100, numero_canal: '5256', fecha: '2026-10-15', numero_trazabilidad: '225MLE' },
          { id: 2, animal_id: 101, numero_canal: '5257', fecha: '2026-10-15', numero_trazabilidad: '438MLF' }]];
      }
      if (/FROM catalogo_cortes/.test(sql)) return [[{ codigo: '22229' }, { codigo: '22101' }]];
      return [[]];
    },
  };
  const plan = await motor.planificar(conn, 'solicitud-deshuese-excel', { pegado: { texto: TEXTO_DESHUESE } }, FOTO);
  const [f] = plan.filas;
  assert.equal(f.fecha, '2026-10-15');
  assert.equal(f.accion, 'nuevo');
  assert.equal(f.canales_ligadas, 2);
  assert.ok(f.avisos.some((a) => /81FLB.*no hay sacrificio/.test(a))); // la tercera canal no está registrada
  assert.ok(f.revisar_foto); // con avisos y leído por foto
  // Sin «Deshuese ddmmaa» en el texto: la fecha la pone la pantalla.
  const sinTitulo = TEXTO_DESHUESE.split('\n').slice(1).join('\n');
  const sinFecha = await motor.planificar(conn, 'solicitud-deshuese-excel', { pegado: { texto: sinTitulo } }, FOTO);
  assert.equal(sinFecha.filas[0].accion, 'error');
  const conFecha = await motor.planificar(conn, 'solicitud-deshuese-excel', { pegado: { texto: sinTitulo } }, { ...FOTO, fecha_texto: '15/10/2026' });
  assert.equal(conFecha.filas[0].fecha, '2026-10-15');
  // Texto que no es una solicitud: error claro, no 500.
  const otro = await motor.planificar(conn, 'solicitud-deshuese-excel', { pegado: { texto: 'hola' } }, FOTO);
  assert.match(otro.filas[0].errores[0], /formato de solicitud/);
});

test('marcas de foto: dudosas saneadas y sin foto no se toca nada', () => {
  assert.deepEqual(dudosasDe({ dudosas: ['??', ' 225MLF ', 'x', 7, '225MLF', 'a'.repeat(100)] }), ['225MLF', 'a'.repeat(60)]);
  assert.deepEqual(dudosasDe(null), []);
  const plan = { filas: [{ fila: 1, arete: '2??MLE', errores: [], avisos: [] }] };
  marcarLecturaFoto(plan, {});
  assert.equal(plan.filas[0].revisar_foto, undefined);
  marcarLecturaFoto(plan, FOTO);
  assert.equal(plan.filas[0].revisar_foto, true);
  assert.equal(plan.leido_por_foto.filas_revisar, 1);
});

test('marcas de foto: en una tanda mixta solo se marcan las filas del texto (la foto), no las de un PDF', () => {
  const plan = { filas: [
    { fila: 1, documento: 'lote-02.pdf', errores: ['x'], avisos: [] },
    { fila: 2, documento: 'Texto pegado', errores: ['x'], avisos: [] },
  ] };
  marcarLecturaFoto(plan, FOTO);
  assert.deepEqual(plan.filas.map((f) => [Boolean(f.leido_por_foto), Boolean(f.revisar_foto)]), [[false, false], [true, true]]);
});
