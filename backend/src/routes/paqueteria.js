const router = require('express').Router();
const { pool } = require('../models/database');

function pad(n, w) { return String(n).padStart(w, '0'); }
function ymd(d = new Date()) { return `${d.getFullYear()}${pad(d.getMonth()+1,2)}${pad(d.getDate(),2)}`; }

async function fetchFuentes(paqueteria_id) {
  const [rows] = await pool.query(`
    SELECT f.*, a.numero_trazabilidad,
           d.numero_lote AS deshuese_numero_lote,
           d.fecha AS deshuese_fecha
    FROM paqueteria_fuentes f
    LEFT JOIN animales a ON f.animal_id = a.id
    LEFT JOIN deshuese d ON f.deshuese_id = d.id
    WHERE f.paqueteria_id = ?
    ORDER BY f.id
  `, [paqueteria_id]);
  return rows;
}

function computeRendimiento(peso_entrada, peso_final, aditivos) {
  const entrada = parseFloat(peso_entrada || 0) + parseFloat(aditivos || 0);
  const final = parseFloat(peso_final || 0);
  if (entrada <= 0 || final <= 0) return null;
  return parseFloat(((final / entrada) * 100).toFixed(2));
}

// Calcula dias_desde_deshuese a partir del deshuese_id (DATEDIFF NOW vs deshuese.fecha).
async function calcDiasDesdeDeshuese(conn, deshuese_id) {
  if (!deshuese_id) return null;
  const [rows] = await conn.query(
    'SELECT DATEDIFF(NOW(), fecha) AS dias FROM deshuese WHERE id = ?',
    [deshuese_id]
  );
  if (!rows.length) return null;
  return rows[0].dias != null ? parseInt(rows[0].dias, 10) : null;
}

// Devuelve { ok, message, dias, max } segun la temporalidad y el numero de dias.
function validatePlazo(temporalidad, dias) {
  const t = (temporalidad || 'fresco').toLowerCase();
  if (dias == null) return { ok: true, dias: null, max: null };
  if (t === 'fresco' || t === 'madurado') {
    if (dias > 7) {
      return {
        ok: false,
        dias,
        max: 7,
        message: `Producto fresco/madurado excede 7 dias desde deshuese (${dias} dias)`,
      };
    }
  } else if (t === 'congelado') {
    if (dias > 365) {
      return {
        ok: false,
        dias,
        max: 365,
        message: `Producto congelado excede 365 dias desde deshuese (${dias} dias, max 365)`,
      };
    }
  }
  return { ok: true, dias, max: t === 'congelado' ? 365 : 7 };
}

router.get('/', async (req, res) => {
  const { tipo_producto, estado } = req.query;
  let sql = 'SELECT * FROM productos_paqueteria WHERE 1=1';
  const params = [];
  if (tipo_producto) { sql += ' AND tipo_producto = ?'; params.push(tipo_producto); }
  if (estado) { sql += ' AND estado = ?'; params.push(estado); }
  sql += ' ORDER BY fecha DESC';
  try {
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM productos_paqueteria WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Producto no encontrado' });
    const fuentes = await fetchFuentes(req.params.id);
    res.json({ ...rows[0], fuentes });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  const { tipo_producto, fecha, peso_entrada_kg, aditivos_kg, responsable, notas, fuentes = [] } = req.body;
  const force = req.query.force === '1' || req.query.force === 'true';
  if (!tipo_producto || !fecha || peso_entrada_kg == null) {
    return res.status(400).json({ error: 'tipo_producto, fecha y peso_entrada_kg son requeridos' });
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const today = ymd();
    const prefix = {
      carne_molida: 'CM', chorizo: 'CH', tortas: 'TO', hamburguesa: 'HB', otro: 'OT',
    }[tipo_producto] || 'PQ';
    const [cnt] = await conn.query('SELECT COUNT(*) as c FROM productos_paqueteria WHERE numero_lote LIKE ?', [`${prefix}-${today}-%`]);
    const numero_lote = `${prefix}-${today}-${pad(cnt[0].c + 1, 3)}`;

    const [result] = await conn.query(`
      INSERT INTO productos_paqueteria (numero_lote, tipo_producto, fecha, peso_entrada_kg, aditivos_kg, responsable, estado, notas)
      VALUES (?, ?, ?, ?, ?, ?, 'en_proceso', ?)
    `, [numero_lote, tipo_producto, fecha, peso_entrada_kg, aditivos_kg || 0, responsable || null, notas || null]);
    const paqueteria_id = result.insertId;

    const totalFuentes = fuentes.reduce((s, f) => s + parseFloat(f.peso_kg || 0), 0);
    for (const f of fuentes) {
      if (!f.animal_id || !f.peso_kg) continue;
      const prop = totalFuentes > 0 ? parseFloat(((parseFloat(f.peso_kg) / totalFuentes) * 100).toFixed(2)) : null;

      // Campos nuevos (temporalidad + plazos + codigos + fecha_ingreso)
      const temporalidad = f.temporalidad || 'fresco';
      let dias = null;
      if (f.deshuese_id) {
        dias = await calcDiasDesdeDeshuese(conn, f.deshuese_id);
      } else if (f.dias_desde_deshuese != null) {
        dias = parseInt(f.dias_desde_deshuese, 10);
      }
      const validation = validatePlazo(temporalidad, dias);
      let notasFinal = f.notas || null;
      if (!validation.ok) {
        if (!force) {
          await conn.rollback();
          return res.status(400).json({ error: validation.message });
        }
        const warn = `PLAZO EXCEDIDO: ${validation.dias} dias`;
        notasFinal = notasFinal ? `${notasFinal} | ${warn}` : warn;
      }

      await conn.query(`
        INSERT INTO paqueteria_fuentes
          (paqueteria_id, animal_id, origen, peso_kg, porcionado_id, deshuese_id, proporcion_pct, notas,
           temporalidad, dias_desde_deshuese, codigo_box, codigo_lot, fecha_ingreso)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        paqueteria_id, f.animal_id, f.origen || 'trim', f.peso_kg,
        f.porcionado_id || null, f.deshuese_id || null, prop, notasFinal,
        temporalidad, dias, f.codigo_box || null, f.codigo_lot || null, f.fecha_ingreso || null,
      ]);
    }
    await conn.commit();
    const [rows] = await pool.query('SELECT * FROM productos_paqueteria WHERE id = ?', [paqueteria_id]);
    const fuenteRows = await fetchFuentes(paqueteria_id);
    res.status(201).json({ ...rows[0], fuentes: fuenteRows });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally { conn.release(); }
});

// Crear una fuente individual para un paqueteria existente.
// Acepta: animal_id, peso_kg, origen, porcionado_id, deshuese_id, notas,
//         temporalidad, dias_desde_deshuese, codigo_box, codigo_lot, fecha_ingreso.
// Query: ?force=1 para permitir bypass del plazo.
router.post('/:id/fuentes', async (req, res) => {
  const paqueteria_id = req.params.id;
  const force = req.query.force === '1' || req.query.force === 'true';
  const f = req.body || {};
  if (!f.animal_id || f.peso_kg == null) {
    return res.status(400).json({ error: 'animal_id y peso_kg son requeridos' });
  }
  const conn = await pool.getConnection();
  try {
    const [prod] = await conn.query('SELECT id FROM productos_paqueteria WHERE id = ?', [paqueteria_id]);
    if (!prod.length) { conn.release(); return res.status(404).json({ error: 'Producto no encontrado' }); }

    const temporalidad = f.temporalidad || 'fresco';
    let dias = null;
    if (f.deshuese_id) {
      dias = await calcDiasDesdeDeshuese(conn, f.deshuese_id);
    } else if (f.dias_desde_deshuese != null) {
      dias = parseInt(f.dias_desde_deshuese, 10);
    }
    const validation = validatePlazo(temporalidad, dias);
    let notasFinal = f.notas || null;
    if (!validation.ok) {
      if (!force) {
        conn.release();
        return res.status(400).json({ error: validation.message });
      }
      const warn = `PLAZO EXCEDIDO: ${validation.dias} dias`;
      notasFinal = notasFinal ? `${notasFinal} | ${warn}` : warn;
    }

    const [result] = await conn.query(`
      INSERT INTO paqueteria_fuentes
        (paqueteria_id, animal_id, origen, peso_kg, porcionado_id, deshuese_id, proporcion_pct, notas,
         temporalidad, dias_desde_deshuese, codigo_box, codigo_lot, fecha_ingreso)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      paqueteria_id, f.animal_id, f.origen || 'trim', f.peso_kg,
      f.porcionado_id || null, f.deshuese_id || null, f.proporcion_pct || null, notasFinal,
      temporalidad, dias, f.codigo_box || null, f.codigo_lot || null, f.fecha_ingreso || null,
    ]);

    const [created] = await pool.query(`
      SELECT f.*, a.numero_trazabilidad,
             d.numero_lote AS deshuese_numero_lote,
             d.fecha AS deshuese_fecha
      FROM paqueteria_fuentes f
      LEFT JOIN animales a ON f.animal_id = a.id
      LEFT JOIN deshuese d ON f.deshuese_id = d.id
      WHERE f.id = ?
    `, [result.insertId]);
    res.status(201).json(created[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) try { conn.release(); } catch (_) {}
  }
});

// Actualizar una fuente (recalcula dias y valida plazo).
router.put('/:id/fuentes/:fuenteId', async (req, res) => {
  const { id: paqueteria_id, fuenteId } = req.params;
  const force = req.query.force === '1' || req.query.force === 'true';
  const f = req.body || {};
  const conn = await pool.getConnection();
  try {
    const [existing] = await conn.query(
      'SELECT * FROM paqueteria_fuentes WHERE id = ? AND paqueteria_id = ?',
      [fuenteId, paqueteria_id]
    );
    if (!existing.length) { conn.release(); return res.status(404).json({ error: 'Fuente no encontrada' }); }
    const cur = existing[0];

    const temporalidad = f.temporalidad != null ? f.temporalidad : (cur.temporalidad || 'fresco');
    const deshuese_id = f.deshuese_id !== undefined ? f.deshuese_id : cur.deshuese_id;
    let dias = null;
    if (deshuese_id) {
      dias = await calcDiasDesdeDeshuese(conn, deshuese_id);
    } else if (f.dias_desde_deshuese != null) {
      dias = parseInt(f.dias_desde_deshuese, 10);
    } else {
      dias = cur.dias_desde_deshuese;
    }
    const validation = validatePlazo(temporalidad, dias);
    let notasFinal = f.notas !== undefined ? f.notas : cur.notas;
    if (!validation.ok) {
      if (!force) {
        conn.release();
        return res.status(400).json({ error: validation.message });
      }
      const warn = `PLAZO EXCEDIDO: ${validation.dias} dias`;
      notasFinal = notasFinal ? `${notasFinal} | ${warn}` : warn;
    }

    await conn.query(`
      UPDATE paqueteria_fuentes SET
        animal_id = ?, origen = ?, peso_kg = ?, porcionado_id = ?, deshuese_id = ?,
        proporcion_pct = ?, notas = ?, temporalidad = ?, dias_desde_deshuese = ?,
        codigo_box = ?, codigo_lot = ?, fecha_ingreso = ?
      WHERE id = ?
    `, [
      f.animal_id != null ? f.animal_id : cur.animal_id,
      f.origen != null ? f.origen : cur.origen,
      f.peso_kg != null ? f.peso_kg : cur.peso_kg,
      f.porcionado_id !== undefined ? f.porcionado_id : cur.porcionado_id,
      deshuese_id,
      f.proporcion_pct !== undefined ? f.proporcion_pct : cur.proporcion_pct,
      notasFinal,
      temporalidad,
      dias,
      f.codigo_box !== undefined ? f.codigo_box : cur.codigo_box,
      f.codigo_lot !== undefined ? f.codigo_lot : cur.codigo_lot,
      f.fecha_ingreso !== undefined ? f.fecha_ingreso : cur.fecha_ingreso,
      fuenteId,
    ]);

    const [updated] = await pool.query(`
      SELECT f.*, a.numero_trazabilidad,
             d.numero_lote AS deshuese_numero_lote,
             d.fecha AS deshuese_fecha
      FROM paqueteria_fuentes f
      LEFT JOIN animales a ON f.animal_id = a.id
      LEFT JOIN deshuese d ON f.deshuese_id = d.id
      WHERE f.id = ?
    `, [fuenteId]);
    res.json(updated[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) try { conn.release(); } catch (_) {}
  }
});

// GET de fuentes de un paqueteria (con join a deshuese para numero_lote / fecha).
router.get('/:id/fuentes', async (req, res) => {
  try {
    const fuentes = await fetchFuentes(req.params.id);
    res.json(fuentes);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Scan de fuente por codigo_lot (numero de lote del deshuese): hace lookup del deshuese
// y crea la fuente con animal_id / deshuese_id / dias derivados.
// Body: { codigo_lot, codigo_box?, peso_kg, paqueteria_id, temporalidad?, fecha_ingreso?, origen?, notas? }
// Query: ?force=1 permite bypass del plazo.
router.post('/scan-fuente', async (req, res) => {
  const force = req.query.force === '1' || req.query.force === 'true';
  const { codigo_lot, codigo_box, peso_kg, paqueteria_id, temporalidad, fecha_ingreso, origen, notas } = req.body || {};
  if (!codigo_lot) return res.status(400).json({ error: 'codigo_lot es requerido' });
  if (!paqueteria_id) return res.status(400).json({ error: 'paqueteria_id es requerido' });
  if (peso_kg == null) return res.status(400).json({ error: 'peso_kg es requerido' });

  const conn = await pool.getConnection();
  try {
    const [prod] = await conn.query('SELECT id FROM productos_paqueteria WHERE id = ?', [paqueteria_id]);
    if (!prod.length) { conn.release(); return res.status(404).json({ error: 'Producto paqueteria no encontrado' }); }

    const [deshueseRows] = await conn.query(
      'SELECT id AS deshuese_id, animal_id, fecha, DATEDIFF(NOW(), fecha) AS dias FROM deshuese WHERE numero_lote = ?',
      [codigo_lot]
    );
    if (!deshueseRows.length) {
      conn.release();
      return res.status(404).json({ error: `Deshuese no encontrado para codigo_lot=${codigo_lot}` });
    }
    const d = deshueseRows[0];
    const dias = d.dias != null ? parseInt(d.dias, 10) : null;

    const tempFinal = temporalidad || 'fresco';
    const validation = validatePlazo(tempFinal, dias);
    let notasFinal = notas || null;
    if (!validation.ok) {
      if (!force) {
        conn.release();
        return res.status(400).json({ error: validation.message });
      }
      const warn = `PLAZO EXCEDIDO: ${validation.dias} dias`;
      notasFinal = notasFinal ? `${notasFinal} | ${warn}` : warn;
    }

    const [result] = await conn.query(`
      INSERT INTO paqueteria_fuentes
        (paqueteria_id, animal_id, origen, peso_kg, deshuese_id, notas,
         temporalidad, dias_desde_deshuese, codigo_box, codigo_lot, fecha_ingreso)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      paqueteria_id, d.animal_id, origen || 'trim', peso_kg, d.deshuese_id, notasFinal,
      tempFinal, dias, codigo_box || null, codigo_lot, fecha_ingreso || null,
    ]);

    const [created] = await pool.query(`
      SELECT f.*, a.numero_trazabilidad,
             d.numero_lote AS deshuese_numero_lote,
             d.fecha AS deshuese_fecha
      FROM paqueteria_fuentes f
      LEFT JOIN animales a ON f.animal_id = a.id
      LEFT JOIN deshuese d ON f.deshuese_id = d.id
      WHERE f.id = ?
    `, [result.insertId]);
    res.status(201).json(created[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) try { conn.release(); } catch (_) {}
  }
});

router.post('/:id/terminar', async (req, res) => {
  const { peso_final_kg } = req.body;
  if (peso_final_kg == null) return res.status(400).json({ error: 'peso_final_kg requerido' });
  try {
    const [existing] = await pool.query('SELECT * FROM productos_paqueteria WHERE id = ?', [req.params.id]);
    if (!existing.length) return res.status(404).json({ error: 'Producto no encontrado' });
    const rend = computeRendimiento(existing[0].peso_entrada_kg, peso_final_kg, existing[0].aditivos_kg);
    await pool.query(
      "UPDATE productos_paqueteria SET peso_final_kg = ?, rendimiento_pct = ?, estado = 'terminado' WHERE id = ?",
      [peso_final_kg, rend, req.params.id]
    );
    const [rows] = await pool.query('SELECT * FROM productos_paqueteria WHERE id = ?', [req.params.id]);
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id/prorrateo', async (req, res) => {
  try {
    const [prod] = await pool.query('SELECT * FROM productos_paqueteria WHERE id = ?', [req.params.id]);
    if (!prod.length) return res.status(404).json({ error: 'Producto no encontrado' });
    const fuentes = await fetchFuentes(req.params.id);
    const pesoFinal = parseFloat(prod[0].peso_final_kg || 0);
    const totalFuentes = fuentes.reduce((s, f) => s + parseFloat(f.peso_kg || 0), 0);
    const prorrateo = fuentes.map(f => {
      const prop = totalFuentes > 0 ? parseFloat(f.peso_kg) / totalFuentes : 0;
      return {
        animal_id: f.animal_id,
        numero_trazabilidad: f.numero_trazabilidad,
        peso_origen_kg: parseFloat(f.peso_kg),
        proporcion_pct: parseFloat((prop * 100).toFixed(2)),
        peso_final_asignado_kg: parseFloat((prop * pesoFinal).toFixed(3)),
      };
    });
    res.json({ producto: prod[0], prorrateo });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM productos_paqueteria WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json({ message: 'Producto eliminado' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
