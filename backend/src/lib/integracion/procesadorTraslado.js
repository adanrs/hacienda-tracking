// Procesador del evento traslado.recibido (tienda → ganadería), modos «encendido» y «pruebas».
//
// La tienda recibe POR CAJA (Juan Carlos, 06-nov-2026: la planta pistolea la caja completa sin
// abrirla). El evento trae las cajas que llegaron a la puerta (`cajas`) y las diferencias que la
// tienda registró, cada una con su acción (devolver en el mismo transporte / avisar a la planta) y
// su motivo. Acá se cruza contra las cajas de la orden de salida y queda, por caja:
//   recibida   · estaba en la orden y llegó con su peso
//   otro_peso  · llegó, pero la tienda informó otro peso (diferencia peso_no_cuadra)
//   faltante   · estaba en la orden y no llegó
//   sobrante   · llegó sin estar en la orden (caja_no_solicitada)
//
// Todavía NO se mueve inventario por etiqueta (`etiquetas` / `movimientos_etiqueta`): la 107 vive en
// el snapshot semanal de la planta, no en el kardex v10, y las cajas que salieron dejan de aparecer
// en el inventario de la semana siguiente. Lo que se guarda es el traspaso de responsabilidad
// (quién y cuándo de cada lado) y las diferencias, que es lo que JC pidió controlar.

const { normalizar } = require('../etiquetas');

class ErrorEvento extends Error {
  constructor(status, codigo, detalle) {
    super(detalle || codigo);
    this.status = status;
    this.codigo = codigo;
  }
}

const redondear = (x) => (x === null || x === undefined || !Number.isFinite(Number(x)) ? null : Math.round(Number(x) * 1000) / 1000);

/**
 * Cruza lo esperado (ítems de la orden) con lo que informó la tienda. Puro.
 * @param esperados [{ id, codigo_barras, peso_kg }]
 * @param datos     `datos` del evento traslado.recibido (ya validado por eventos.js)
 * @returns {{ cajas: object[], resumen: object, estado: 'recibida'|'recibida_con_diferencias' }}
 */
function compararRecepcion(esperados, datos) {
  const difs = Array.isArray(datos.diferencias) ? datos.diferencias : [];
  const difDe = (tipo, codigo) => difs.find(d => d.tipo === tipo && d.codigo && normalizar(d.codigo) === codigo);
  // Llegaron (con multiplicidad: dos cajas idénticas cuentan dos veces).
  const llegaron = new Map();
  for (const c of datos.cajas || []) {
    const k = normalizar(c.codigo);
    if (!llegaron.has(k)) llegaron.set(k, []);
    llegaron.get(k).push(c);
  }
  const cajas = [];
  for (const e of esperados) {
    const codigo = normalizar(e.codigo_barras);
    const kgEsperado = redondear(e.peso_kg);
    const lista = llegaron.get(codigo);
    if (lista && lista.length) {
      const c = lista.shift();
      const dPeso = difDe('peso_no_cuadra', codigo);
      const kgRecibido = redondear(c.kg_recibido ?? (dPeso ? dPeso.recibido : null) ?? c.kg_etiqueta ?? kgEsperado);
      const otroPeso = Boolean(dPeso) || (kgRecibido !== null && kgEsperado !== null && Math.abs(kgRecibido - kgEsperado) > 0.0005);
      const d = otroPeso ? dPeso : difs.find(x => x.codigo && normalizar(x.codigo) === codigo && x.accion);
      cajas.push({ item_id: e.id, codigo, resultado: otroPeso ? 'otro_peso' : 'recibida', kg_esperado: kgEsperado, kg_recibido: kgRecibido,
        accion: d ? d.accion || null : null, motivo: d ? d.motivo || null : null });
    } else {
      const d = difDe('caja_faltante', codigo);
      cajas.push({ item_id: e.id, codigo, resultado: 'faltante', kg_esperado: kgEsperado, kg_recibido: null,
        accion: d ? d.accion || null : null, motivo: d ? d.motivo || null : null });
    }
  }
  for (const [codigo, lista] of llegaron) {
    for (const c of lista) {
      const d = difDe('caja_no_solicitada', codigo);
      cajas.push({ item_id: null, codigo, resultado: 'sobrante', kg_esperado: null,
        kg_recibido: redondear(c.kg_recibido ?? c.kg_etiqueta), accion: d ? d.accion || null : null, motivo: d ? d.motivo || null : null });
    }
  }
  const cuenta = (r) => cajas.filter(c => c.resultado === r).length;
  const resumen = {
    cajas_recibidas: cuenta('recibida') + cuenta('otro_peso'),
    cajas_faltantes: cuenta('faltante'),
    cajas_sobrantes: cuenta('sobrante'),
    cajas_otro_peso: cuenta('otro_peso'),
    kg_esperado: redondear(esperados.reduce((s, e) => s + Number(e.peso_kg || 0), 0)),
    kg_recibido: redondear(cajas.reduce((s, c) => s + Number(c.kg_recibido || 0), 0)),
  };
  // Cualquier diferencia que mandó la tienda (también las de paquete o producto) marca la recepción.
  const conDif = cajas.some(c => c.resultado !== 'recibida') || difs.length > 0;
  return { cajas, resumen, estado: conDif ? 'recibida_con_diferencias' : 'recibida' };
}

/**
 * Aplica el evento dentro de la transacción abierta en `conn` (la misma que guarda
 * integracion_eventos: o queda todo o nada). Devuelve { avisos, recepcion }.
 * En modo «pruebas» solo acepta órdenes marcadas es_prueba (si no, 422 solo_pruebas).
 */
async function aplicarTrasladoRecibido(conn, sobre, { modo }) {
  const d = sobre.datos;
  const avisos = [];
  let orden = null;
  if (d.numero_orden) {
    const [r] = await conn.query(`
      SELECT o.id, o.numero, o.estado, o.es_prueba, o.recepcion_estado, bd.codigo AS destino
      FROM ordenes_salida o LEFT JOIN bodegas bd ON bd.id = o.bodega_destino_id
      WHERE o.numero = ? FOR UPDATE`, [d.numero_orden]);
    orden = r[0] || null;
    // En «pruebas» lo primero: una orden real no se toca, esté como esté.
    if (modo === 'pruebas' && !(orden && orden.es_prueba)) {
      throw new ErrorEvento(422, 'solo_pruebas', 'En modo pruebas solo se aplican recepciones de traslados marcados PRUEBA');
    }
    if (!orden) avisos.push({ tipo: 'orden_desconocida', numero_orden: d.numero_orden });
    else {
      // Una orden que no es traslado a la tienda, que no salió o que ya tiene su recepción no se
      // toca: aplicar igual dejaría dos recepciones (o una de una orden que nunca salió) y la
      // diferencia quedaría escondida. La tienda lo ve como error permanente y el admin decide.
      if (orden.destino !== 'WC-01') throw new ErrorEvento(422, 'orden_no_es_traslado_tienda', `La orden ${d.numero_orden} no va a WC-01`);
      if (orden.estado !== 'despachada') throw new ErrorEvento(409, 'orden_no_despachada', `La orden ${d.numero_orden} está ${orden.estado}`);
      if (orden.recepcion_estado) throw new ErrorEvento(409, 'orden_ya_recibida', `La orden ${d.numero_orden} ya tiene su recepción (${orden.recepcion_estado})`);
    }
  }
  if (modo === 'pruebas' && !(orden && orden.es_prueba)) {
    throw new ErrorEvento(422, 'solo_pruebas', 'En modo pruebas solo se aplican recepciones de traslados marcados PRUEBA');
  }
  const [esperados] = orden
    ? await conn.query('SELECT id, codigo_barras, peso_kg FROM ordenes_salida_items WHERE orden_id = ? AND codigo_barras IS NOT NULL ORDER BY id', [orden.id])
    : [[]];
  const r = compararRecepcion(esperados, d);
  const usuario = sobre.origen && typeof sobre.origen.usuario === 'string' ? sobre.origen.usuario.slice(0, 160) : null;
  const cerrada = new Date(d.cerrada_en);
  const [ins] = await conn.query(`
    INSERT INTO recepciones_tienda (orden_id, numero_orden, evento_clave, recepcion_tienda, estado, recibida_por, cerrada_en,
      cajas_recibidas, cajas_faltantes, cajas_sobrantes, cajas_otro_peso, kg_esperado, kg_recibido)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [orden ? orden.id : null, d.numero_orden || null, sobre.clave, String(d.recepcion_id), r.estado, usuario, cerrada,
    r.resumen.cajas_recibidas, r.resumen.cajas_faltantes, r.resumen.cajas_sobrantes, r.resumen.cajas_otro_peso, r.resumen.kg_esperado, r.resumen.kg_recibido]);
  for (const c of r.cajas) {
    await conn.query(`
      INSERT INTO recepciones_tienda_cajas (recepcion_id, item_id, codigo, resultado, kg_esperado, kg_recibido, accion, motivo)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [ins.insertId, c.item_id, c.codigo.slice(0, 64), c.resultado, c.kg_esperado, c.kg_recibido, c.accion, c.motivo ? String(c.motivo).slice(0, 300) : null]);
  }
  if (orden) {
    await conn.query('UPDATE ordenes_salida SET recepcion_estado = ?, recepcion_en = ?, recepcion_por = ? WHERE id = ?',
      [r.estado, cerrada, usuario, orden.id]);
  }
  return { avisos, recepcion: { id: ins.insertId, numero_orden: d.numero_orden || null, estado: r.estado, ...r.resumen } };
}

module.exports = { compararRecepcion, aplicarTrasladoRecibido, ErrorEvento };
