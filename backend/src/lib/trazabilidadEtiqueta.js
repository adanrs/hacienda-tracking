// Trazabilidad de una etiqueta de caja o primal cuya etiqueta NO trae el animal («xxx»).
//
// El puente (dueño, 05-nov-2026): el lote de 10 dígitos de la etiqueta es la FECHA DEL DESHUESE
// (DDMMAA en la caja, MMDDAA en el primal) + el LOTE DE DESHUESE (4 dígitos en la caja, 2 en el
// primal), que es el «Lote CC» del Reporte de producción de CIISA de ese día (deshuese del 19-mar-2026:
// caja «…190326 0035…» = Lote CC 35 = arete 279SKF; el traslado de custodia también dice «LOTE 35»).
// El reporte, a su vez, ya está amarrado a un arete (tabla Lote CC → arete del correo, validada contra
// la guía). Entonces:
//   fecha + lote de la etiqueta → UN reporte de producción cargado con arete confirmado → arete.
// Reglas:
//   - la fecha se lee SOLO con el formato de la etiqueta (caja DDMMAA, primal MMDDAA: etiquetas.js).
//     Nunca se prueba la otra lectura para ligar: si se necesitara (formato dudoso), con dos lecturas
//     válidas y distintas NO se auto-liga;
//   - el lote de la etiqueta se compara SOLO con el «Lote CC» del reporte. NO con el «Num. Lote»:
//     ese es el correlativo del PDF en el día (1, 2, 3…) y con él la etiqueta del Lote CC 35 se ligaba
//     al animal del PDF n.º 35 del día, o a ninguno;
//   - más de un reporte que calce → «sin trazabilidad» con la lista de candidatos;
//   - la recuperación es automática pero visible: estado «recuperada», con el reporte que la
//     respalda, y una advertencia para que quede auditada en la vista previa;
//   - NUNCA se cruza contra sacrificios.numero_canal: el n.º de canal se pierde al pasar a deshuese.
// Esta función solo LEE.

const { interpretarFecha } = require('./etiquetas');

/** Las dos lecturas posibles de la fecha del lote (sin repetir) a partir del texto de 6 dígitos. */
function lecturasFecha(texto6, formatoPrincipal) {
  const otro = formatoPrincipal === 'DDMMAA' ? 'MMDDAA' : 'DDMMAA';
  const fechas = [];
  for (const f of [formatoPrincipal, otro]) {
    const r = interpretarFecha(texto6, f);
    if (r.fecha && !fechas.includes(r.fecha)) fechas.push(r.fecha);
  }
  return fechas;
}

/** Fecha(s) y lote de deshuese de una lectura de caja o primal; null si no aplica. */
function puenteDe(lectura) {
  if (!lectura || !lectura.campos) return null;
  const c = lectura.campos;
  if (!Number.isInteger(c.loteDeshuese) || c.loteDeshuese <= 0) return null;
  // La fecha ya interpretada por el decodificador con el formato fijo de cada etiqueta.
  const fechaEtiqueta = lectura.tipo === 'caja' ? c.fecha : lectura.tipo === 'primal' ? c.fechaEmpaque : null;
  if (!fechaEtiqueta) return null;
  return { fechas: [fechaEtiqueta], lote: c.loteDeshuese };
}

/**
 * Busca el reporte de producción que respalda una etiqueta sin animal.
 * @returns {Promise<{estado:'recuperada'|'sin_trazabilidad', arete?:string, animal_id?:number, reporte_id?:number,
 *   fecha_produccion?:string, lote_cc?:number, num_lote?:string, motivo:string, candidatos:object[]}>}
 */
async function recuperarPorReporte(db, lectura) {
  const p = puenteDe(lectura);
  if (!p || !p.fechas.length) return { estado: 'sin_trazabilidad', motivo: 'La etiqueta no trae fecha y lote de deshuese legibles', candidatos: [] };
  const condiciones = p.fechas.map(() => '(rp.fecha_produccion = ? AND rp.lote_cc = ?)').join(' OR ');
  const params = p.fechas.flatMap((f) => [f, p.lote]);
  const [filas] = await db.query(
    `SELECT rp.id AS reporte_id, DATE_FORMAT(rp.fecha_produccion, '%Y-%m-%d') AS fecha_produccion, rp.num_lote, rp.lote_cc,
            l.arete, l.animal_id
     FROM reporte_produccion rp
     JOIN lotes_cc_aretes l ON l.fecha_deshuese = rp.fecha_produccion AND l.lote_cc = rp.lote_cc
     WHERE l.animal_id IS NOT NULL AND (${condiciones})`, params);
  const candidatos = filas.map((f) => ({ reporte_id: f.reporte_id, fecha_produccion: f.fecha_produccion, lote_cc: f.lote_cc, num_lote: f.num_lote, arete: f.arete, animal_id: f.animal_id }));
  if (candidatos.length === 1) {
    const c = candidatos[0];
    return {
      estado: 'recuperada', ...c,
      motivo: `Trazabilidad recuperada: fecha ${c.fecha_produccion.split('-').reverse().join('/')} + Lote CC ${p.lote} calzan con el reporte de producción del arete ${c.arete}`,
      candidatos,
    };
  }
  if (candidatos.length > 1) {
    return { estado: 'sin_trazabilidad', motivo: `Ambiguo: fecha + Lote CC ${p.lote} calzan con ${candidatos.length} reportes (${candidatos.map((c) => c.arete).join(', ')}); no se asigna animal`, candidatos };
  }
  return { estado: 'sin_trazabilidad', motivo: `No hay reporte de producción con arete para el Lote CC ${p.lote} del ${p.fechas.map((f) => f.split('-').reverse().join('/')).join(' ni del ')}`, candidatos };
}

module.exports = { recuperarPorReporte, lecturasFecha, puenteDe };
