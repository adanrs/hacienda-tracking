// Separación entre las bodegas del flujo viejo (BOD-*) y las del núcleo v10 (12, 107, WC-01).
//
// Por qué: hasta el corte v10 el inventario de 12/107/WC-01 vive en `etiquetas` y
// `movimientos_etiqueta`, no en `primales.bodega_actual_id` ni en `movimientos_bodega`. Si el flujo
// viejo (custodia, órdenes) pudiera mover un primal a 107 o sacar una orden desde WC-01, quedarían
// existencias en dos modelos que no se concilian. Decisión del 05-nov: el flujo viejo no las usa,
// salvo WC-01 como DESTINO de una orden de salida (así se despacha a la tienda).
// Excepción (Juan Carlos, 05/06-nov-2026): los traslados a la tienda SALEN DE LA 107 (producto
// terminado). La orden 107 → WC-01 no mueve primales ni cajas internas: sus líneas son cajas del
// inventario de la planta (routes/traslados-tienda.js), así que no mezcla los dos modelos.
// Una bodega es v10 si tiene `naturaleza` (las BOD-* la tienen NULL hasta el corte).

const WC01 = 'WC-01';
const B107 = '107';

/** Devuelve Map(id → codigo) de las bodegas v10 entre `ids` (ignora vacíos). */
async function bodegasV10(conn, ids) {
  const lista = [...new Set(ids.filter(v => v !== undefined && v !== null && v !== '').map(Number))];
  if (!lista.length) return new Map();
  try {
    const [r] = await conn.query('SELECT id, codigo FROM bodegas WHERE id IN (?) AND naturaleza IS NOT NULL', [lista]);
    return new Map(r.map(b => [Number(b.id), b.codigo]));
  } catch (e) {
    // Sin la columna (migración v10 no aplicada) no hay bodegas v10 que proteger.
    if (e.code === 'ER_BAD_FIELD_ERROR') return new Map();
    throw e;
  }
}

/** Mensaje de error si alguna de las bodegas es v10 (flujo viejo: custodia, entradas). */
async function errorSiV10(conn, ids, campo = 'bodega') {
  const v10 = await bodegasV10(conn, ids);
  if (!v10.size) return null;
  return `La ${campo} ${[...v10.values()].join(', ')} es del inventario por etiqueta (v10) y no se usa en este flujo`;
}

/**
 * Reglas de la orden de salida: el origen nunca es v10 (salvo 107 → WC-01, el traslado a la
 * tienda); el destino puede ser una BOD-* o WC-01; origen ≠ destino. Devuelve un mensaje de error o null.
 */
async function errorBodegasOrdenSalida(conn, { origen, destino }) {
  const vacio = (v) => v === undefined || v === null || v === '';
  if (!vacio(origen) && !vacio(destino) && Number(origen) === Number(destino)) {
    return 'La bodega de origen y la de destino no pueden ser la misma';
  }
  const v10 = await bodegasV10(conn, [origen, destino]);
  const trasladoTienda = !vacio(origen) && !vacio(destino) && v10.get(Number(origen)) === B107 && v10.get(Number(destino)) === WC01;
  if (!vacio(origen) && v10.has(Number(origen)) && !trasladoTienda) {
    return `La bodega de origen ${v10.get(Number(origen))} es del inventario por etiqueta (v10): no se despacha por órdenes de salida`;
  }
  if (!vacio(destino) && v10.has(Number(destino)) && v10.get(Number(destino)) !== WC01) {
    return `La bodega de destino ${v10.get(Number(destino))} es del inventario por etiqueta (v10): como destino solo se admite ${WC01}`;
  }
  return null;
}

module.exports = { bodegasV10, errorSiV10, errorBodegasOrdenSalida, WC01, B107 };
