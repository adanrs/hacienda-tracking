// Procesador del listado completo del catálogo de cortes (Excel de la planta o texto pegado).
//
// Compara cada código contra `catalogo_cortes`: nuevo / cambia (qué campo, antes → después) / sin
// cambios. NUNCA desactiva lo que no viene en el listado (un listado parcial no debe apagar cortes
// que los históricos siguen usando); desactivar es explícito (columna «activo» = no/0/inactivo).
// Cada alta o cambio deja bitácora en catalogo_cortes_bitacora con la importación que lo hizo, y al
// final se recarga el catálogo en memoria del decodificador de etiquetas.

const { marcas } = require('../comun');
const { TIPOS_CORTE } = require('../../../models/produccionCatalogo');
const catalogoCortes = require('../../catalogoCortes');

const UNIDADES = { kg: 'kg', kgs: 'kg', kilo: 'kg', kilos: 'kg', caja: 'caja', cajas: 'caja', unidad: 'unidad', und: 'unidad', un: 'unidad' };
const sinTildes = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

function tipoDe(v) {
  if (v == null || v === '') return { valor: undefined };
  const t = sinTildes(v).replace(/\s+/g, '');
  const alias = { trim: 'trimming', trimmings: 'trimming', recorte: 'trimming', hueso: 'hueso', huesos: 'hueso', subprimal: 'subprimal', primal: 'primal', subproducto: 'subproducto', despojo: 'subproducto' };
  const r = alias[t] || (TIPOS_CORTE.includes(t) ? t : null);
  return r ? { valor: r } : { error: `Tipo «${v}» desconocido (primal, subprimal, hueso, subproducto, trimming)` };
}

function activoDe(v) {
  if (v == null || v === '') return { valor: undefined };
  const t = sinTildes(v);
  if (['1', 'si', 'sí', 'activo', 'a', 'x', 'true'].includes(t)) return { valor: 1 };
  if (['0', 'no', 'inactivo', 'i', 'false', 'baja'].includes(t)) return { valor: 0 };
  return { error: `Activo «${v}» no se entiende (sí/no)` };
}

async function planificar(conn, tabla) {
  const filas = tabla.filas.map((f) => ({ fila: f.fila, v: f.valores, errores: [...f.errores], avisos: [] }));
  const codigos = [...new Set(filas.map((f) => String(f.v.codigo || '').trim()).filter((c) => /^\d{5}$/.test(c)))];
  let actuales = [];
  if (codigos.length) [actuales] = await conn.query(`SELECT id, codigo, nombre, tipo, unidad, activo FROM catalogo_cortes WHERE codigo IN (${marcas(codigos.length)})`, codigos);
  const porCodigo = new Map(actuales.map((a) => [a.codigo, a]));
  const vistos = new Map();
  const salida = filas.map((f) => {
    const codigo = String(f.v.codigo || '').trim();
    const item = { fila: f.fila, entidad: 'corte', clave: codigo, accion: 'nuevo', cambios: [], errores: f.errores, avisos: f.avisos };
    if (codigo === catalogoCortes.CODIGO_PENDIENTE) item.errores.push('El 99 es el código genérico de pendientes: no se importa');
    else if (!/^\d{5}$/.test(codigo)) item.errores.push(`Código «${codigo}» no es de 5 dígitos`);
    else if (vistos.has(codigo)) item.errores.push(`Código ${codigo} repetido (también en la fila ${vistos.get(codigo)})`);
    else vistos.set(codigo, f.fila);
    const nombre = String(f.v.nombre || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!nombre) item.errores.push('Descripción vacía');
    const tipo = tipoDe(f.v.tipo); if (tipo.error) item.errores.push(tipo.error);
    const unidadTxt = f.v.unidad ? sinTildes(f.v.unidad) : null;
    const unidad = unidadTxt ? UNIDADES[unidadTxt] : undefined;
    if (unidadTxt && !unidad) item.errores.push(`Unidad «${f.v.unidad}» desconocida (kg, caja, unidad)`);
    const activo = activoDe(f.v.activo); if (activo.error) item.errores.push(activo.error);
    item.datos = { codigo, nombre, tipo: tipo.valor, unidad, activo: activo.valor };
    const actual = porCodigo.get(codigo);
    if (actual) {
      item.corte_id = actual.id;
      for (const [campo, etiqueta] of [['nombre', 'Descripción'], ['tipo', 'Tipo'], ['unidad', 'Unidad'], ['activo', 'Activo']]) {
        const nuevo = item.datos[campo];
        if (nuevo === undefined) continue;
        if (String(actual[campo] ?? '') !== String(nuevo)) item.cambios.push({ campo, etiqueta, antes: actual[campo], despues: nuevo });
      }
      item.accion = item.cambios.length ? 'actualizar' : 'sin_cambios';
    }
    if (item.errores.length) item.accion = 'error';
    return item;
  });
  return { filas: salida, errores_generales: [] };
}

async function aplicar(conn, plan, { importacionId, usuarioId, registrar }) {
  const res = { creados: 0, actualizados: 0 };
  const bit = async (corteId, codigo, accion, detalle) => conn.query(
    `INSERT INTO catalogo_cortes_bitacora (corte_id, codigo, accion, detalle, origen, importacion_id, usuario_id) VALUES (?, ?, ?, ?, 'importacion', ?, ?)`,
    [corteId, codigo, accion, JSON.stringify(detalle), importacionId, usuarioId || null]);
  for (const it of plan.filas) {
    if (it.accion === 'error' || it.accion === 'sin_cambios') continue;
    const d = it.datos;
    if (it.accion === 'nuevo') {
      const [r] = await conn.query(
        'INSERT INTO catalogo_cortes (codigo, nombre, tipo, unidad, activo) VALUES (?, ?, ?, ?, ?)',
        [d.codigo, d.nombre, d.tipo || 'primal', d.unidad || 'kg', d.activo === undefined ? 1 : d.activo]);
      await bit(r.insertId, d.codigo, 'creado', { nombre: d.nombre, tipo: d.tipo || 'primal' });
      registrar(it.fila, 'corte', r.insertId, 'creado', { codigo: d.codigo });
      res.creados++;
    } else {
      // Solo las columnas que cambiaron (lista fija: el nombre de columna nunca viene del archivo).
      const permitidas = ['nombre', 'tipo', 'unidad', 'activo'];
      const sets = it.cambios.filter((c) => permitidas.includes(c.campo));
      await conn.query(`UPDATE catalogo_cortes SET ${sets.map((c) => `${c.campo} = ?`).join(', ')} WHERE id = ?`, [...sets.map((c) => c.despues), it.corte_id]);
      await bit(it.corte_id, d.codigo, 'editado', { cambios: it.cambios });
      registrar(it.fila, 'corte', it.corte_id, 'actualizado', { cambios: it.cambios });
      res.actualizados++;
    }
  }
  await catalogoCortes.recargar(conn);
  return { resumen: res };
}

module.exports = { planificar, aplicar };
