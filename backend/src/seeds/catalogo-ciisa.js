const { CATALOGO_CIISA, CATALOGO_POR_CODIGO, CODIGOS_INTERNOS_PREVIOS } = require('../data/catalogo-ciisa');

const NOTA_PREVIO_V10 = 'código interno previo a v10';

const COLUMNAS = [
  'codigo', 'nombre', 'nombre_en', 'tipo', 'serie', 'genetica', 'codigo_equivalente', 'unidad',
  'vida_util_dias', 'vida_congelado_dias', 'ventana_min_dias', 'ventana_max_dias', 'nota_enlace', 'notas',
];

/**
 * Carga el catálogo real CIISA (v10, anexos C1–C4) en catalogo_cortes. Idempotente:
 *  - Inserta o actualiza por `codigo` (UNIQUE). En la actualización no toca `activo`
 *    (respeta un código real que alguien haya desactivado a mano) ni pisa `abreviatura`.
 *  - Desactiva (activo = 0) los códigos que sembraba la versión anterior y que no son reales,
 *    sin borrarlos (pueden tener stickers asociados), y les agrega la nota «código interno previo a v10».
 * @param {import('mysql2/promise').Pool|import('mysql2/promise').PoolConnection} db
 */
async function sembrarCatalogoCiisa(db) {
  const placeholders = `(${COLUMNAS.map(() => '?').join(', ')})`;
  const valores = CATALOGO_CIISA.map((c) => COLUMNAS.map((col) => c[col]));
  const actualizar = COLUMNAS.filter((c) => c !== 'codigo').map((c) => `${c} = VALUES(${c})`).join(', ');

  await db.query(
    `INSERT INTO catalogo_cortes (${COLUMNAS.join(', ')}) VALUES ${valores.map(() => placeholders).join(', ')}
     ON DUPLICATE KEY UPDATE ${actualizar}`,
    valores.flat(),
  );

  const previos = CODIGOS_INTERNOS_PREVIOS.filter((c) => !CATALOGO_POR_CODIGO[c]);
  const [r] = await db.query(
    `UPDATE catalogo_cortes
        SET activo = 0,
            notas = CONCAT_WS(' · ', NULLIF(notas, ''), ?)
      WHERE codigo IN (?)
        AND (notas IS NULL OR notas NOT LIKE ?)`,
    [NOTA_PREVIO_V10, previos, `%${NOTA_PREVIO_V10}%`],
  );

  console.log(`Catálogo CIISA v10: ${CATALOGO_CIISA.length} códigos cargados/actualizados; ${r.affectedRows} códigos previos desactivados`);
}

module.exports = { sembrarCatalogoCiisa, NOTA_PREVIO_V10 };
