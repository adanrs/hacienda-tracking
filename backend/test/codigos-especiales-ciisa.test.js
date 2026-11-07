// Códigos de producto terminado que la planta CIISA confirmó el 07-nov-2026 (Juan Carlos):
// 26641 New York Bone In (F1), 26682 Porterhouse FB, 26683 T-Bone FB y 26674 BCH paquetería.
// Las etiquetas de caja se arman con el formato real (25 caracteres):
//   producto(5) + peso(5, kg × 100) + XXX + fecha DDMMAA + lote(4) + sufijo(2)
// p. ej. 2661300599XXX231225003111 = 26613 · 5.99 kg · 23/12/2025 · lote 0031 · sufijo 11.
const test = require('node:test');
const assert = require('node:assert/strict');
const { decodificar, serieDeCodigo } = require('../src/lib/etiquetas');
const catalogo = require('../src/lib/catalogoCortes');
const { CATALOGO_POR_CODIGO, CODIGOS_ANTERIORES } = require('../src/data/catalogo-ciisa');

const caja = (producto, peso = '00599') => `${producto}${peso}XXX231225003111`;

test('el ejemplo de formato del pedido decodifica como caja', () => {
  const r = decodificar('2661300599XXX231225003111');
  assert.equal(r.tipo, 'caja');
  assert.deepEqual(r.errores, []);
  assert.equal(r.campos.codigoProducto, '26613');
  assert.equal(r.campos.pesoKg, 5.99);
  assert.equal(r.campos.fecha, '2025-12-23');
  assert.equal(r.campos.loteTexto, '0031');
  assert.equal(r.campos.sufijo, '11');
});

const NUEVOS = [
  { codigo: '26641', producto: 'New York Bone In', serie: 'F1', tipo: 'retail' },
  { codigo: '26682', producto: 'Porterhouse', serie: 'FB', tipo: 'retail' },
  { codigo: '26683', producto: 'T-Bone', serie: 'FB', tipo: 'retail' },
  { codigo: '26674', producto: 'BCH paquetería', serie: 'F1', tipo: 'bch' },
];

for (const n of NUEVOS) {
  test(`caja ${n.codigo} (${n.producto}) se reconoce sin base de datos`, () => {
    catalogo.olvidar(); // solo el archivo: así arranca el decodificador antes de leer MySQL
    const r = decodificar(caja(n.codigo, '01234'));
    assert.equal(r.tipo, 'caja');
    assert.deepEqual(r.errores, []);
    assert.equal(r.campos.codigoProducto, n.codigo);
    assert.equal(r.campos.producto, n.producto);
    assert.equal(r.campos.serie, n.serie);
    assert.equal(r.campos.pesoKg, 12.34);
    assert.equal(r.campos.fecha, '2025-12-23');
    assert.equal(r.campos.codigoVigente, undefined);
    assert.equal(CATALOGO_POR_CODIGO[n.codigo].tipo, n.tipo);
  });
}

test('26682 / 26683 son FB aunque empiecen por 266 (regla explícita, sin catálogo)', () => {
  catalogo.fijar([]); // base leída pero vacía: decide la regla de FB fuera de serie
  try {
    assert.equal(serieDeCodigo('26682'), 'FB');
    assert.equal(serieDeCodigo('26683'), 'FB');
    assert.equal(serieDeCodigo('26641'), 'F1');
  } finally {
    catalogo.olvidar();
  }
});

test('equivalencia F1↔FB: Porterhouse 26643↔26682 y T-Bone 26644↔26683', () => {
  assert.equal(CATALOGO_POR_CODIGO['26643'].codigo_equivalente, '26682');
  assert.equal(CATALOGO_POR_CODIGO['26682'].codigo_equivalente, '26643');
  assert.equal(CATALOGO_POR_CODIGO['26644'].codigo_equivalente, '26683');
  assert.equal(CATALOGO_POR_CODIGO['26683'].codigo_equivalente, '26644');
  assert.equal(CATALOGO_POR_CODIGO['26641'].codigo_equivalente, null);
  assert.equal(CATALOGO_POR_CODIGO['26674'].genetica, null); // el recorte puede mezclar animales
});

test('26345 / 26347 del v10 siguen existiendo como código anterior del mismo producto', () => {
  catalogo.olvidar();
  assert.deepEqual({ ...CODIGOS_ANTERIORES }, { 26345: '26682', 26347: '26683' });
  for (const [anterior, vigente] of Object.entries(CODIGOS_ANTERIORES)) {
    const entrada = CATALOGO_POR_CODIGO[anterior];
    assert.ok(entrada, `${anterior} no debe borrarse del catálogo`);
    assert.equal(entrada.codigo_equivalente, null);
    assert.equal(entrada.serie, 'FB');
    assert.equal(entrada.nombre, CATALOGO_POR_CODIGO[vigente].nombre);
    assert.equal(catalogo.codigoVigente(anterior), vigente);

    const r = decodificar(caja(anterior));
    assert.equal(r.tipo, 'caja');
    assert.deepEqual(r.errores, []);
    assert.equal(r.campos.codigoProducto, anterior); // se respeta lo que trae la etiqueta
    assert.equal(r.campos.codigoVigente, vigente);
    assert.equal(r.campos.producto, CATALOGO_POR_CODIGO[vigente].nombre);
  }
  assert.equal(catalogo.codigoVigente('26682'), '26682');
});

test('con la base cargada, el decodificador usa el nombre de la base', () => {
  catalogo.fijar([{ codigo: '26641', nombre: 'NY Bone In (base)', serie: 'F1' }]);
  try {
    const r = decodificar(caja('26641'));
    assert.equal(r.campos.producto, 'NY Bone In (base)');
  } finally {
    catalogo.olvidar();
  }
});
