// Recepción de traslados planta → tienda (Juan Carlos, 06-nov-2026): la planta pistolea la caja
// completa sin abrirla, así que la tienda recibe POR CAJA (los paquetes son opcionales) y, ante una
// diferencia, la devuelve en el mismo transporte o avisa a la planta, con motivo.
const test = require('node:test');
const assert = require('node:assert/strict');
const { validarSobre } = require('../src/lib/integracion/eventos');

const sobre = (datos) => ({ v: 1, clave: 'traslado.recibido:7', tipo: 'traslado.recibido', ocurrido_en: '2026-11-06T10:00:00-06:00', origen: { app: 'tienda' }, datos });
const base = { numero_orden: 'OS-20261106-001', recepcion_id: 7, cerrada_en: '2026-11-06T10:00:00-06:00' };
const CAJA = '2661700874XXX061125003511';

test('traslado.recibido: una caja sin paquetes (no se abrió) es válida', () => {
  const r = validarSobre(sobre({ ...base, cajas: [{ codigo: CAJA, copia: 1, kg_etiqueta: 8.74 }], diferencias: [] }));
  assert.equal(r.ok, true, r.errores && r.errores.join('; '));
});

test('traslado.recibido: diferencia con acción «devolver en el mismo transporte» o «avisar a planta» exige motivo', () => {
  const con = (d) => validarSobre(sobre({ ...base, cajas: [{ codigo: CAJA, copia: 1, kg_etiqueta: 8.74 }], diferencias: [d] }));
  assert.equal(con({ tipo: 'peso_no_cuadra', accion: 'devolver_mismo_transporte', motivo: 'Pesa 7.9 kg, la etiqueta dice 8.74' }).ok, true);
  assert.equal(con({ tipo: 'paquete_no_coincide', accion: 'avisar_planta', motivo: 'Venía denver en lugar de ribeye' }).ok, true);
  assert.equal(con({ tipo: 'peso_no_cuadra' }).ok, true, 'la acción es opcional (eventos de antes)');
  assert.match(con({ tipo: 'peso_no_cuadra', accion: 'devolver_mismo_transporte' }).errores.join(' '), /motivo es obligatorio/);
  assert.match(con({ tipo: 'peso_no_cuadra', accion: 'tirarla', motivo: 'x' }).errores.join(' '), /accion debe ser una de/);
});

test('traslado.recibido: no llegó ninguna caja (todo faltante) es válido si trae las diferencias', () => {
  const r = validarSobre(sobre({ ...base, cajas: [], diferencias: [{ tipo: 'caja_faltante', codigo: CAJA, accion: 'avisar_planta', motivo: 'No llegó el camión' }] }));
  assert.equal(r.ok, true, r.errores.join('; '));
  const vacia = validarSobre(sobre({ ...base, cajas: [], diferencias: [] }));
  assert.equal(vacia.ok, false);
  assert.match(vacia.errores.join(), /al menos una caja o una diferencia/);
});
