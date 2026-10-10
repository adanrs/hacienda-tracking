const test = require('node:test');
const assert = require('node:assert/strict');
const {
  decodificar, validarArete, normalizarArete, serieDeCodigo, interpretarFecha,
} = require('../src/lib/etiquetas');
const { CATALOGO_CIISA, CATALOGO_POR_CODIGO } = require('../src/data/catalogo-ciisa');

const codigos = (r) => r.errores.map((e) => e.codigo);

// Ejemplos reales del documento v10 (§4.2 D)
const PAQUETE = '0103-M266322309243300416F101';
const CAJA_CON_ESPACIOS = '26640 00469 XXX 220125 0031 11';
const PRIMAL_CON_ESPACIOS = '21231 31203 02304 031126 20 10';

// ── Paquete (A) ─────────────────────────────────────────────────────────────

test('paquete real sin espacios', () => {
  const r = decodificar(PAQUETE);
  assert.equal(r.tipo, 'paquete');
  assert.deepEqual(r.errores, []);
  assert.equal(r.campos.arete, '0103-M');
  assert.equal(r.campos.codigoProducto, '26632');
  assert.equal(r.campos.serie, 'F1');
  assert.equal(r.campos.producto, 'Denver Steak');
  assert.equal(r.campos.fechaProduccion, '2024-09-23');
  assert.equal(r.campos.fechaAmbigua, false);
  assert.equal(r.campos.loteDeshuese, 33);
  assert.equal(r.campos.loteTexto, '33');
  assert.equal(r.campos.pesoKg, 0.416);
  assert.equal(r.campos.pesoGramos, 416);
  assert.equal(r.campos.genetica, 'F1');
  assert.equal(r.campos.marmoleo, 1);
  assert.equal(r.crudo, PAQUETE);
});

test('paquete real con espacios y saltos de línea', () => {
  const r = decodificar(' 0103-M 26632 230924 33\n00416 F1 01\r\n');
  assert.equal(r.tipo, 'paquete');
  assert.deepEqual(r.errores, []);
  assert.equal(r.campos.arete, '0103-M');
  assert.equal(r.campos.pesoKg, 0.416);
});

test('paquete con arete alfanumérico sin guion', () => {
  const r = decodificar('34GKAE266322309243300416F101');
  assert.equal(r.tipo, 'paquete');
  assert.deepEqual(r.errores, []);
  assert.equal(r.campos.arete, '34GKAE');
});

test('paquete con fecha ambigua (día ≤ 12)', () => {
  const r = decodificar('0103-M266320503243300416F101');
  assert.equal(r.campos.fechaProduccion, '2024-03-05');
  assert.equal(r.campos.fechaAmbigua, true);
  assert.ok(r.advertencias.some((a) => a.codigo === 'fecha_ambigua'));
  assert.deepEqual(r.errores, []);
});

test('paquete con fecha imposible (día 32 y mes 13)', () => {
  const dia32 = decodificar('0103-M266323209243300416F101');
  assert.ok(codigos(dia32).includes('fecha_imposible'));
  assert.equal(dia32.campos.fechaProduccion, null);

  const mes13 = decodificar('0103-M266320113243300416F101');
  assert.ok(codigos(mes13).includes('fecha_imposible'));
});

test('genética cruzada: código F1 en etiqueta FB (caso Denver 26632, §11.3)', () => {
  const r = decodificar('0103-M266322309243300416FB01');
  assert.ok(codigos(r).includes('genetica_cruzada'));
});

test('genética cruzada: código FB en etiqueta F1', () => {
  const r = decodificar('0103-M263412309243300416F101');
  assert.equal(r.campos.serie, 'FB');
  assert.ok(codigos(r).includes('genetica_cruzada'));
});

test('genética cruzada con FB fuera de serie (26680 Osobuco FB)', () => {
  const r = decodificar('0103-M266802309243300416F101');
  assert.equal(r.campos.serie, 'FB');
  assert.ok(codigos(r).includes('genetica_cruzada'));
});

test('genética inválida', () => {
  const r = decodificar('0103-M266322309243300416F201');
  assert.ok(codigos(r).includes('genetica_invalida'));
});

test('marmoleo fuera de rango', () => {
  const r = decodificar('0103-M266322309243300416F113');
  assert.ok(codigos(r).includes('marmoleo_invalido'));
});

test('paquete con arete inválido', () => {
  const r = decodificar('01-3-M266322309243300416F101');
  assert.equal(r.tipo, 'paquete');
  assert.ok(codigos(r).includes('arete_invalido'));
});

// ── Caja (B) ────────────────────────────────────────────────────────────────

test('caja real con espacios', () => {
  const r = decodificar(CAJA_CON_ESPACIOS);
  assert.equal(r.tipo, 'caja');
  assert.deepEqual(r.errores, []);
  assert.equal(r.campos.codigoProducto, '26640');
  assert.equal(r.campos.producto, 'Osobuco');
  assert.equal(r.campos.serie, 'F1');
  assert.equal(r.campos.pesoKg, 4.69);
  assert.equal(r.campos.campoXXX, 'XXX');
  assert.equal(r.campos.fecha, '2025-01-22');
  assert.equal(r.campos.fechaAmbigua, false);
  assert.equal(r.campos.loteDeshuese, 31);
  assert.equal(r.campos.loteTexto, '0031');
  assert.equal(r.campos.loteLegible, '2201250031');
  assert.equal(r.campos.sufijo, '11');
});

test('caja real sin espacios', () => {
  const r = decodificar(CAJA_CON_ESPACIOS.replace(/ /g, ''));
  assert.equal(r.tipo, 'caja');
  assert.equal(r.campos.pesoKg, 4.69);
  assert.equal(r.campos.loteDeshuese, 31);
});

test('caja con XXX en minúsculas se normaliza y no se valida', () => {
  const r = decodificar('2664000469xxx220125003111');
  assert.equal(r.tipo, 'caja');
  assert.equal(r.campos.campoXXX, 'XXX');
});

test('caja con XXX numérico es ambigua (indistinguible de primal)', () => {
  const r = decodificar('26640 00469 123 220125 0031 11');
  assert.equal(r.tipo, 'ambigua');
  assert.ok(codigos(r).includes('tipo_ambiguo'));
  assert.equal(r.alternativas.length, 2);
  const caja = r.alternativas.find((a) => a.tipo === 'caja');
  const primal = r.alternativas.find((a) => a.tipo === 'primal');
  assert.equal(caja.campos.pesoKg, 4.69);
  assert.equal(caja.campos.fecha, '2025-01-22');
  assert.ok(primal);
});

// ── Primal (C) ──────────────────────────────────────────────────────────────

test('primal real con espacios (fecha MMDDAA)', () => {
  const r = decodificar(PRIMAL_CON_ESPACIOS);
  assert.equal(r.tipo, 'primal');
  assert.deepEqual(r.errores, []);
  assert.equal(r.campos.codigoProducto, '21231');
  assert.equal(r.campos.serie, 'ARREO');
  assert.equal(r.campos.producto, 'Delmonico');
  assert.equal(r.campos.box, '31203');
  assert.equal(r.campos.pesoKg, 23.04);
  assert.equal(r.campos.fechaEmpaque, '2026-03-11');
  assert.equal(r.campos.fechaAmbigua, true); // día 11 ≤ 12
  assert.equal(r.campos.loteDeshuese, 20);
  assert.equal(r.campos.loteTexto, '20');
  assert.equal(r.campos.loteLegible, '03112620');
  assert.equal(r.campos.sufijo, '10');
});

test('primal real sin espacios (todo dígitos)', () => {
  const r = decodificar(PRIMAL_CON_ESPACIOS.replace(/ /g, ''));
  assert.equal(r.tipo, 'primal');
  assert.equal(r.campos.pesoKg, 23.04);
});

test('primal con fecha no ambigua (día > 12)', () => {
  const r = decodificar('2123131203023040325262010');
  assert.equal(r.tipo, 'primal');
  assert.equal(r.campos.fechaEmpaque, '2026-03-25');
  assert.equal(r.campos.fechaAmbigua, false);
});

// ── Largo y entradas raras ──────────────────────────────────────────────────

test('largo incorrecto → desconocida', () => {
  for (const malo of ['', '12345', PAQUETE + '9', '2123131203023040311262010X1']) {
    const r = decodificar(malo);
    assert.equal(r.tipo, 'desconocida', malo);
    assert.ok(codigos(r).includes('largo_invalido'));
  }
  assert.equal(decodificar(null).tipo, 'desconocida');
});

// ── Helpers ─────────────────────────────────────────────────────────────────

test('validarArete', () => {
  assert.equal(validarArete('0103-M').valido, true);
  assert.equal(validarArete('34GKAE').valido, true);
  assert.equal(validarArete('34gkae').arete, '34GKAE');
  assert.equal(validarArete('0103M').valido, false);   // 5
  assert.equal(validarArete('0103-MX').valido, false); // 7
  assert.equal(validarArete('-0103M').valido, false);
  assert.equal(validarArete('01-3-M').valido, false);
  assert.equal(validarArete('0103_M').valido, false);
});

test('normalizarArete detecta arete invertido sin corregir', () => {
  const a = normalizarArete('DJF526');
  assert.equal(a.arete, 'DJF526');
  assert.equal(a.alternativaInvertida, '526DJF');
  assert.ok(a.advertencias.some((w) => w.codigo === 'arete_posiblemente_invertido'));

  const b = normalizarArete('526djf');
  assert.equal(b.arete, '526DJF');
  assert.equal(b.alternativaInvertida, 'DJF526');

  const c = normalizarArete('0103-M');
  assert.equal(c.alternativaInvertida, null);
  assert.deepEqual(c.advertencias, []);
});

test('serieDeCodigo', () => {
  assert.equal(serieDeCodigo('26632'), 'F1');
  assert.equal(serieDeCodigo('26341'), 'FB');
  assert.equal(serieDeCodigo('26676'), 'FB');
  assert.equal(serieDeCodigo('26680'), 'FB');
  assert.equal(serieDeCodigo('26684'), 'FB');
  assert.equal(serieDeCodigo('26554'), 'F1'); // Ribeye Filet F1 fuera de 266xx
  assert.equal(serieDeCodigo('26636'), 'PVA');
  assert.equal(serieDeCodigo('26344'), 'PVA'); // catálogo manda sobre el prefijo 263
  assert.equal(serieDeCodigo('29710'), 'PVA');
  assert.equal(serieDeCodigo('21231'), 'ARREO');
  assert.equal(serieDeCodigo('40108'), 'ARREO');
  assert.equal(serieDeCodigo('26699'), 'F1'); // no catalogado, por prefijo
  assert.equal(serieDeCodigo('26399'), 'FB');
  assert.equal(serieDeCodigo('99999'), null);
  assert.equal(serieDeCodigo('abc'), null);
  assert.equal(serieDeCodigo(null), null);
});

test('interpretarFecha valida calendario real', () => {
  assert.equal(interpretarFecha('290224', 'DDMMAA').fecha, '2024-02-29');
  assert.equal(interpretarFecha('290225', 'DDMMAA').error.codigo, 'fecha_imposible');
  assert.equal(interpretarFecha('000125', 'DDMMAA').error.codigo, 'fecha_imposible');
  assert.equal(interpretarFecha('0501AB', 'DDMMAA').error.codigo, 'fecha_invalida');
  // día == mes: ambas lecturas coinciden, no es ambigua
  assert.equal(interpretarFecha('050525', 'DDMMAA').fechaAmbigua, false);
});

// ── Catálogo ────────────────────────────────────────────────────────────────

test('catálogo: códigos únicos y equivalencias F1↔FB simétricas', () => {
  assert.equal(Object.keys(CATALOGO_POR_CODIGO).length, CATALOGO_CIISA.length);
  for (const c of CATALOGO_CIISA) {
    assert.match(c.codigo, /^\d{5}$/);
    if (c.codigo_equivalente) {
      const eq = CATALOGO_POR_CODIGO[c.codigo_equivalente];
      assert.ok(eq, `equivalente de ${c.codigo} no existe`);
      assert.equal(eq.codigo_equivalente, c.codigo);
      assert.notEqual(eq.genetica, c.genetica);
    }
  }
  assert.equal(CATALOGO_POR_CODIGO['26632'].codigo_equivalente, '26341');
  assert.equal(CATALOGO_POR_CODIGO['26645'].codigo_equivalente, '26684');
});
