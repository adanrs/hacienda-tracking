// Consecutivos atómicos sobre la tabla `consecutivos` del núcleo v10 (serie, anio, ultimo).
//
// Por qué: las órdenes de salida/entrada se numeraban con «cantidad del día + 1» (COUNT(*)+1).
// Dos usuarios creando a la vez leían el mismo conteo y el segundo chocaba con el UNIQUE de
// `numero` (500 al usuario); además, borrar una orden hacía que el siguiente número repitiera uno
// ya emitido. Aquí el número sale de un UPDATE sobre una sola fila: InnoDB serializa a los
// concurrentes en el candado de esa fila y LAST_INSERT_ID(expr) devuelve el valor de ESTA
// conexión sin una segunda lectura que pueda cruzarse con otra.
//
// Se llama DENTRO de la transacción que inserta el documento: si el documento hace rollback, el
// incremento también (no quedan huecos) y el candado de la fila dura hasta el commit.

/**
 * Serie diaria para la tabla consecutivos: `serie` es VARCHAR(10), así que el día va como
 * PREFIJO-MMDD y el año en `anio` (p. ej. OS-1105 / 2026).
 */
function serieDiaria(prefijo, fecha = new Date()) {
  const mm = String(fecha.getMonth() + 1).padStart(2, '0');
  const dd = String(fecha.getDate()).padStart(2, '0');
  const serie = `${prefijo}-${mm}${dd}`;
  if (serie.length > 10) throw new Error(`Serie de consecutivo demasiado larga: ${serie}`);
  return { serie, anio: fecha.getFullYear() };
}

/**
 * Devuelve el siguiente número de la serie.
 * @param conn     conexión con la transacción abierta (pool.getConnection + beginTransaction)
 * @param semilla  async (conn) => número ya usado en la serie antes de que existiera el contador
 *                 (p. ej. el máximo de las órdenes ya creadas hoy). Solo se consulta la primera
 *                 vez que aparece la serie, para no repetir números emitidos por el código viejo.
 */
async function siguienteConsecutivo(conn, { serie, anio, semilla }) {
  const [fila] = await conn.query('SELECT ultimo FROM consecutivos WHERE serie = ? AND anio = ?', [serie, anio]);
  if (!fila.length) {
    const inicial = semilla ? Math.max(0, Number(await semilla(conn)) || 0) : 0;
    // Si otra transacción creó la fila entre la lectura y aquí, este INSERT espera su commit y
    // no cambia nada (ultimo = ultimo). No se usa INSERT IGNORE: escondería otros errores.
    await conn.query(
      'INSERT INTO consecutivos (serie, anio, ultimo) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE ultimo = ultimo',
      [serie, anio, inicial]);
  }
  await conn.query('UPDATE consecutivos SET ultimo = LAST_INSERT_ID(ultimo + 1) WHERE serie = ? AND anio = ?', [serie, anio]);
  const [r] = await conn.query('SELECT LAST_INSERT_ID() AS n');
  const n = Number(r[0].n);
  if (!Number.isInteger(n) || n < 1) throw new Error(`Consecutivo inválido para ${serie}/${anio}`);
  return n;
}

/**
 * Número diario de documento PREFIJO-AAAAMMDD-NNN (formato que ya usan OS/OE).
 * La semilla lee el mayor NNN existente del día en `tabla` para continuar sin chocar.
 */
async function numeroDiario(conn, { prefijo, tabla, fecha = new Date() }) {
  if (!/^[a-z_]+$/.test(tabla)) throw new Error('tabla inválida');
  const ymd = `${fecha.getFullYear()}${String(fecha.getMonth() + 1).padStart(2, '0')}${String(fecha.getDate()).padStart(2, '0')}`;
  const base = `${prefijo}-${ymd}-`;
  const { serie, anio } = serieDiaria(prefijo, fecha);
  const n = await siguienteConsecutivo(conn, {
    serie, anio,
    semilla: async (c) => {
      const [m] = await c.query(
        `SELECT MAX(CAST(SUBSTRING(numero, ?) AS UNSIGNED)) AS m FROM \`${tabla}\` WHERE numero LIKE ?`,
        [base.length + 1, `${base}%`]);
      return m[0] && m[0].m != null ? Number(m[0].m) : 0;
    },
  });
  return `${base}${String(n).padStart(3, '0')}`;
}

module.exports = { siguienteConsecutivo, numeroDiario, serieDiaria };
