// Pruebas de las funciones puras de la carga por foto: `node --test src/` (npm test).
import test from 'node:test';
import assert from 'node:assert/strict';
import { unirPaginas, encabezadoDe, medidaReducida, textoAvance } from './paginas.js';

const P1 = 'Sacrificio Wagyu 15-10-26\nCantidad\tNúmero de canal\tSexo\tArete\n1\t5256\tM\t225MLE\n2\t5257\tM\t438MLF';
const P2 = 'Sacrificio Wagyu 15-10-26\nCantidad\tNúmero  de canal\tSexo\tArete\n3\t5258\tM\t81FLB';

test('unirPaginas: la página 2 no repite el título ni la fila de encabezados', () => {
  assert.equal(unirPaginas([P1, P2]), `${P1}\n3\t5258\tM\t81FLB`);
});

test('unirPaginas: una sola página, vacías y texto corrido sin tabla', () => {
  assert.equal(unirPaginas([P1]), P1);
  assert.equal(unirPaginas(['', '  ']), '');
  assert.equal(unirPaginas(['', P1]), P1);
  // Reporte de producción: cada página es otro reporte con su encabezado; no se quita nada.
  const r1 = 'REPORTE DIARIO DE PRODUCCION\nNum. Lote 2\n22229 CH-CHUCK RES 136.10 KGS 5';
  const r2 = 'REPORTE DIARIO DE PRODUCCION\nNum. Lote 3\n22229 CH-CHUCK RES 120.00 KGS 4';
  assert.equal(unirPaginas([r1, r2]), `${r1}\n${r2}`);
});

test('encabezadoDe: hasta la primera línea con tabulador', () => {
  assert.deepEqual(encabezadoDe(P1), ['Sacrificio Wagyu 15-10-26', 'Cantidad\tNúmero de canal\tSexo\tArete']);
  assert.deepEqual(encabezadoDe('sin tabla'), []);
});

test('medidaReducida: lado mayor a 1600 px, nunca agranda', () => {
  assert.deepEqual(medidaReducida(4032, 3024), { ancho: 1600, alto: 1200 });
  assert.deepEqual(medidaReducida(3024, 4032), { ancho: 1200, alto: 1600 });
  assert.deepEqual(medidaReducida(800, 600), { ancho: 800, alto: 600 });
});

test('textoAvance: página n de m y segundos solo si tarda', () => {
  assert.equal(textoAvance(2, 3, 2), 'Leyendo página 2 de 3…');
  assert.equal(textoAvance(1, 1, 12), 'Leyendo la foto… (12 s)');
});
