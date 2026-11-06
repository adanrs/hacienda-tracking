// Marmoleo de la cámara de canales: lectura del pegado (texto y HTML, con columnas extra) y,
// contra MySQL real (TEST_MYSQL_HOST), el amarre estricto número de sacrificio + arete.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'secreto-solo-para-pruebas-0123456789abcdef';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { leerPegado } = require('../src/lib/importador/archivos');
const { leerHojas } = require('../src/lib/importador/tabla');
const { formato } = require('../src/lib/importador/formatos');
const { separarBody, compararConEtiqueta } = require('../src/lib/importador/procesadores/marmoleoCamara');
const { marmoleoHtml } = require('../scripts/generar-fixtures-importador');

const FIX = path.join(__dirname, 'fixtures');
const MM = formato('marmoleo-camara');
const texto = fs.readFileSync(path.join(FIX, 'marmoleo-camara-pegado.txt'), 'utf8');

test('marmoleo: pegado de texto y de HTML leen lo mismo, con columnas extra guardadas', () => {
  for (const entrada of [{ texto }, { html: marmoleoHtml(), texto: 'x' }]) {
    const r = leerPegado(entrada);
    const t = leerHojas(r.hojas, MM, { textosExtra: r.textos });
    assert.equal(t.filas.length, 7);
    const f = t.filas[0];
    assert.equal(f.valores.taken_at, '2026-08-20 03:37:54');
    assert.equal(f.valores.body, '5111 17DKF');
    assert.equal(f.valores.ausmeat, '4');
    assert.equal(f.valores.dms, 6.41);
    assert.equal(f.valores.dma, 101);
    assert.deepEqual(f.extras, { DMf: '2', Operador: 'cam-1' });
    assert.deepEqual(t.filas.map(x => x.valores.ausmeat), ['4', '5', '5', '4', '5', '2', '5']);
  }
});

test('marmoleo: columnas en otro orden también sirven', () => {
  const r = leerPegado({ texto: 'DMs (AUSMEAT)\tBody no.\tTaken at\n4\t5111 17DKF\t2026-08-20 03:37:54' });
  const t = leerHojas(r.hojas, MM);
  assert.equal(t.filas[0].valores.body, '5111 17DKF');
  assert.equal(t.filas[0].valores.ausmeat, '4');
});

test('Body no. = canal + arete; comparación con la etiqueta', () => {
  assert.deepEqual(separarBody('5111 17DKF'), { canal: '5111', arete: '17DKF' });
  assert.deepEqual(separarBody(' 5109  302mlf '), { canal: '5109', arete: '302MLF' });
  assert.equal(separarBody('5111'), null);
  assert.equal(compararConEtiqueta(4, 4).coincide, true);
  assert.equal(compararConEtiqueta(4, 5).coincide, false);
  assert.equal(compararConEtiqueta(4, 11).comparable, false);
});

test('etiquetas reales (fotos del 05-nov): el marmoleo de la etiqueta es escala 01–12, no AUS-MEAT', () => {
  const { decodificar } = require('../src/lib/etiquetas');
  // Paquete Wagyu Cross FB New York: arete alfanumérico con relleno «0PG087», marmoleo 11.
  const paquete = decodificar('0PG087263382311240702026F111');
  assert.equal(paquete.tipo, 'paquete');
  assert.equal(paquete.campos.arete, '0PG087');
  assert.equal(paquete.campos.areteSinRelleno, 'PG087');
  assert.equal(paquete.campos.marmoleo, 11);
  assert.equal(compararConEtiqueta(5, paquete.campos.marmoleo).comparable, false);
  // Caja BCH 22229 (box 11132, 27.22 kg) y sticker de despacho con «XXX» = sin arete.
  const caja = decodificar('2222911132027221207232410');
  assert.equal(caja.campos.codigoProducto, '22229');
  assert.equal(caja.campos.pesoKg, 27.22);
  const despacho = decodificar('2661300599XXX231225003111');
  assert.equal(despacho.campos.campoXXX, 'XXX');
  assert.equal(despacho.campos.pesoKg, 5.99);
});

const HOST = process.env.TEST_MYSQL_HOST;
if (HOST) {
  process.env.DB_HOST = HOST;
  process.env.DB_PORT = process.env.TEST_MYSQL_PORT || '3306';
  process.env.DB_USER = process.env.TEST_MYSQL_USER || 'hacienda_admin';
  process.env.DB_PASSWORD = process.env.TEST_MYSQL_PASSWORD || 'hacienda_pass';
  process.env.DB_NAME = process.env.TEST_MYSQL_DB || 'hacienda_tracking';
}

test('MySQL real: marmoleo se liga solo con canal + arete; si coincide uno, hay que confirmar', { skip: !HOST && 'sin TEST_MYSQL_HOST' }, async (t) => {
  const { pool, initDB } = require('../src/models/database');
  const motor = require('../src/lib/importador/motor');
  t.after(() => pool.end());
  await initDB();

  // Sacrificios del 18/08/2026: 5 coinciden exacto; la canal 5108 está registrada para 185NKA
  // (la cámara dice 185NKZ) y 5105 / 11ELE no existe.
  const exactos = [['5111', 'MM17DKF'], ['5110', 'MM13NKA'], ['5109', 'MM302MLF'], ['5107', 'MM31DKA'], ['5106', 'MM176FLE']];
  const aretes = [...exactos.map(e => e[1]), 'MM185NKA'];
  await pool.query(`DELETE FROM animales WHERE numero_trazabilidad IN (${aretes.map(() => '?').join(',')})`, aretes);
  const ids = {};
  for (const [canal, arete] of [...exactos, ['5108', 'MM185NKA']]) {
    const [a] = await pool.query("INSERT INTO animales (numero_trazabilidad, tipo, sexo, estado) VALUES (?, 'bovino', 'macho', 'sacrificado')", [arete]);
    const [s] = await pool.query("INSERT INTO sacrificios (animal_id, fecha, numero_canal, peso_vivo, peso_canal_caliente) VALUES (?, '2026-08-18 00:00:00', ?, 700, 420)", [a.insertId, canal]);
    ids[canal] = s.insertId;
  }
  // La cámara usa el arete sin el prefijo de la prueba: se arma el pegado con «MM».
  const pegado = texto.replace(/(\d{4}) (\w+)/g, '$1 MM$2');

  const plan = await motor.planificar(pool, 'marmoleo-camara', { pegado: { texto: pegado } });
  const por = (canal) => plan.filas.find(f => f.body.startsWith(canal));
  assert.equal(por('5111').accion, 'nuevo');
  assert.equal(por('5111').sacrificio_id, ids['5111']);
  assert.equal(por('5108').accion, 'error');
  assert.match(por('5108').errores.join(), /Confirme a mano/);
  assert.deepEqual(por('5108').candidatos.map(c => c.sacrificio_id), [ids['5108']]);
  assert.match(por('5105').errores.join(), /No hay sacrificio/);
  assert.match(plan.reporte_planta, /5108 MM185NKZ.*MM185NKA/);
  assert.equal(plan.resumen.nuevos, 5);

  // Confirmar a mano la 5108 y aplicar.
  const opciones = { confirmaciones: { [por('5108').fila]: ids['5108'] } };
  const plan2 = await motor.planificar(pool, 'marmoleo-camara', { pegado: { texto: pegado } }, opciones);
  assert.equal(plan2.filas.find(f => f.body.startsWith('5108')).accion, 'nuevo');
  const r = await motor.aplicar(pool, 'marmoleo-camara', { pegado: { texto: pegado } }, opciones, { huella: plan2.huella });
  assert.equal(r.resultado.resumen.mediciones, 6);
  const [[s]] = await pool.query("SELECT marmoleo, DATE_FORMAT(fecha_marmoleo, '%Y-%m-%d %H:%i:%s') AS f, marmoleo_extra FROM sacrificios WHERE id = ?", [ids['5111']]);
  assert.equal(s.marmoleo, 4);
  assert.equal(s.f, '2026-08-20 03:37:54');
  const extra = typeof s.marmoleo_extra === 'string' ? JSON.parse(s.marmoleo_extra) : s.marmoleo_extra;
  assert.equal(extra.dms_msa, 620);
  assert.equal(extra.DMf, '2');

  // Re-pegar: sin cambios.
  const plan3 = await motor.planificar(pool, 'marmoleo-camara', { pegado: { texto: pegado } }, opciones);
  assert.equal(plan3.resumen.sin_cambios, 6);
});

test('PUT /api/marmoleo: la fecha se valida completa (400, no 500)', () => {
  const { fechaHoraValida } = require('../src/routes/marmoleo');
  assert.equal(fechaHoraValida('2026-08-20'), true);
  assert.equal(fechaHoraValida('2026-08-20 03:37'), true);
  assert.equal(fechaHoraValida('2026-08-20 03:37:54'), true);
  assert.equal(fechaHoraValida('2026-08-20xyz'), false);
  assert.equal(fechaHoraValida('2026-13-45'), false);
  assert.equal(fechaHoraValida('2026-02-30'), false);
  assert.equal(fechaHoraValida('2026-08-20 24:00'), false);
});
