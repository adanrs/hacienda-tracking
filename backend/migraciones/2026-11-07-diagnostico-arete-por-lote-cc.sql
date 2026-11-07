-- Diagnóstico (y corrección propuesta) de los datos ligados por «Num. Lote» antes del fix
-- fix/arete-por-lote-cc (07-nov-2026).
--
-- Por qué: el importador del Reporte diario de producción de CIISA buscaba el arete de la lista del
-- correo con el «Num. Lote» del PDF, y el puente de las etiquetas «xxx» (lib/trazabilidadEtiqueta.js)
-- comparaba el lote de la etiqueta con el «Num. Lote» del reporte. Lo correcto es el «Lote CC»
-- (19/03/26: Num. Lote 1 = Lote CC 35 = 279SKF; traslado 1824 «LOTE 35»; etiquetas 35 / 0035).
--
-- Qué NO quedó mal: las cargas por Excel/CSV/editor manual (lib/reporteProduccion.js) ya usaban el
-- Lote CC; y los reportes donde num_lote = lote_cc (p. ej. el formato de prueba «Num. Lote 2 / Lote CC 02»).
--
-- Cómo usarlo: correr SOLO los SELECT (secciones 1–3) y revisar el resultado con la tabla
-- «Lote CC → arete» de cada correo de deshuese. Las correcciones (sección 4) van comentadas: se
-- corren a mano, con respaldo previo de la base, UNA vez desplegado el fix.
--
--   docker exec -i kiwi-mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" hacienda_tracking' \
--     < backend/migraciones/2026-11-07-diagnostico-arete-por-lote-cc.sql

-- 1. Reportes cargados por el importador con Num. Lote ≠ Lote CC: el arete se buscó en la lista con
--    el Num. Lote. Si la lista del correo venía por Lote CC (lo normal), el animal puede estar MAL o
--    haber quedado «sin animal». Comparar l.arete con el arete del Lote CC en la tabla del correo.
SELECT r.id AS reporte_id, DATE_FORMAT(r.fecha_produccion, '%Y-%m-%d') AS fecha, r.num_lote, r.lote_cc,
       r.origen, r.archivo_nombre, r.importacion_id, l.arete AS arete_ligado, l.animal_id, l.deshuese_id
FROM reporte_produccion r
LEFT JOIN lotes_cc_aretes l ON l.fecha_deshuese = r.fecha_produccion AND l.lote_cc = r.lote_cc
WHERE r.importacion_id IS NOT NULL
  AND r.num_lote REGEXP '^[0-9]+$'
  AND CAST(r.num_lote AS UNSIGNED) <> r.lote_cc
ORDER BY r.fecha_produccion, r.lote_cc;

-- 1b. Deshueses «cerrados» que creó el importador para esos reportes (van al animal ligado en 1).
SELECT d.id AS deshuese_id, d.numero_lote, d.animal_id, a.numero_trazabilidad, d.notas
FROM deshuese d
JOIN animales a ON a.id = d.animal_id
WHERE d.notas LIKE 'Reporte de producción CIISA lote %'
ORDER BY d.fecha;

-- 2. Inventario de la planta: líneas cuyo reporte de respaldo NO tiene el Lote CC de la etiqueta
--    (se trazaron por Num. Lote = arete equivocado).
SELECT l.id, l.carga_id, l.hoja, l.codigo_barras, l.lote, l.trazabilidad, l.arete AS arete_actual,
       rp.id AS reporte_id, rp.num_lote, rp.lote_cc,
       CAST(JSON_UNQUOTE(JSON_EXTRACT(l.decodificado, '$.loteDeshuese')) AS UNSIGNED) AS lote_etiqueta
FROM inventario_planta_lineas l
JOIN reporte_produccion rp ON rp.id = l.reporte_id
WHERE rp.lote_cc <> CAST(JSON_UNQUOTE(JSON_EXTRACT(l.decodificado, '$.loteDeshuese')) AS UNSIGNED);

-- 3. Inventario de la planta: cómo queda cada línea con el puente por Lote CC (arete_nuevo NULL =
--    sin trazabilidad). Muestra solo las que cambian.
SELECT x.id, x.carga_id, x.lote, x.trazabilidad, x.arete AS arete_actual, la.arete AS arete_nuevo,
       rp.id AS reporte_nuevo
FROM (
  SELECT l.*,
         COALESCE(JSON_UNQUOTE(JSON_EXTRACT(l.decodificado, '$.fecha')),
                  JSON_UNQUOTE(JSON_EXTRACT(l.decodificado, '$.fechaEmpaque'))) AS f_etiqueta,
         CAST(JSON_UNQUOTE(JSON_EXTRACT(l.decodificado, '$.loteDeshuese')) AS UNSIGNED) AS lote_etiqueta
  FROM inventario_planta_lineas l
  WHERE l.trazabilidad IN ('con_arete', 'recuperada', 'sin_trazabilidad')
    AND JSON_UNQUOTE(JSON_EXTRACT(l.decodificado, '$.tipo')) IN ('caja', 'primal', 'lote_primal')
) x
LEFT JOIN reporte_produccion rp ON rp.fecha_produccion = x.f_etiqueta AND rp.lote_cc = x.lote_etiqueta
LEFT JOIN lotes_cc_aretes la ON la.fecha_deshuese = rp.fecha_produccion AND la.lote_cc = rp.lote_cc AND la.animal_id IS NOT NULL
WHERE NOT (x.reporte_id <=> IF(la.animal_id IS NULL, NULL, rp.id));

-- 4. CORRECCIONES (comentadas; respaldo antes: mysqldump hacienda_tracking > antes-lote-cc.sql).
--
-- 4a. Reporte mal ligado de la sección 1 (uno por fila, con el arete del Lote CC según el correo):
--   UPDATE lotes_cc_aretes la JOIN animales a ON a.numero_trazabilidad = '<ARETE_CORRECTO>'
--      SET la.arete = a.numero_trazabilidad, la.animal_id = a.id
--    WHERE la.fecha_deshuese = '<AAAA-MM-DD>' AND la.lote_cc = <LOTE_CC>;
--   UPDATE deshuese d JOIN animales a ON a.numero_trazabilidad = '<ARETE_CORRECTO>'
--      SET d.animal_id = a.id
--    WHERE d.id = <DESHUESE_ID>;   -- el deshuese_id de la sección 1
--   (Si el reporte quedó «sin animal» y ahora sí tiene arete, lo más limpio es borrarlo en la vista
--    «Del día» y volver a importarlo con el fix: crea el deshuese y la liga como corresponde.)
--
-- 4b. Inventario de la planta: re-trazar por Lote CC (misma lógica que inventarioCiisa.js:
--     con «xxx»/«000» en el campo XXX de la caja = 'recuperada'; si no, 'con_arete').
-- UPDATE inventario_planta_lineas l
-- JOIN (
--   SELECT x.id, rp.id AS reporte_id, la.arete, la.animal_id,
--          CASE WHEN la.animal_id IS NULL THEN 'sin_trazabilidad'
--               WHEN x.tipo = 'caja' AND (x.xxx REGEXP '^0+$' OR (UPPER(x.xxx) REGEXP 'X' AND UPPER(x.xxx) REGEXP '^[X0]+$'))
--                 THEN 'recuperada'
--               ELSE 'con_arete' END AS traz
--   FROM (
--     SELECT l.id,
--            JSON_UNQUOTE(JSON_EXTRACT(l.decodificado, '$.tipo')) AS tipo,
--            JSON_UNQUOTE(JSON_EXTRACT(l.decodificado, '$.campoXXX')) AS xxx,
--            COALESCE(JSON_UNQUOTE(JSON_EXTRACT(l.decodificado, '$.fecha')),
--                     JSON_UNQUOTE(JSON_EXTRACT(l.decodificado, '$.fechaEmpaque'))) AS f_etiqueta,
--            CAST(JSON_UNQUOTE(JSON_EXTRACT(l.decodificado, '$.loteDeshuese')) AS UNSIGNED) AS lote_etiqueta
--     FROM inventario_planta_lineas l
--     WHERE l.trazabilidad IN ('con_arete', 'recuperada', 'sin_trazabilidad')
--       AND JSON_UNQUOTE(JSON_EXTRACT(l.decodificado, '$.tipo')) IN ('caja', 'primal', 'lote_primal')
--   ) x
--   LEFT JOIN reporte_produccion rp ON rp.fecha_produccion = x.f_etiqueta AND rp.lote_cc = x.lote_etiqueta
--   LEFT JOIN lotes_cc_aretes la ON la.fecha_deshuese = rp.fecha_produccion AND la.lote_cc = rp.lote_cc AND la.animal_id IS NOT NULL
-- ) n ON n.id = l.id
-- SET l.reporte_id = IF(n.animal_id IS NULL, NULL, n.reporte_id), l.arete = n.arete, l.animal_id = n.animal_id,
--     l.trazabilidad = n.traz
-- WHERE NOT (l.reporte_id <=> IF(n.animal_id IS NULL, NULL, n.reporte_id));
