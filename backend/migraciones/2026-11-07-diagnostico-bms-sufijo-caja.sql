-- Diagnóstico (y corrección propuesta) del BMS tomado del SUFIJO de la caja CIISA antes del fix
-- fix/bms-no-desde-caja (07-nov-2026).
--
-- Por qué: del 06 al 07-nov-2026 se leyeron los 2 últimos dígitos del código de caja (25 caracteres)
-- como BMS. Juan Carlos lo corrigió: son un sufijo de la caja de deshuese de significado desconocido
-- (en INV WAGYU #10, 246 de 310 cajas terminan en «11», incluidas molida y tortas sin marmoleo; «10»
-- en primales, 51–56 en BCH/trimming). El BMS de una caja es el marmoleo medido en la canal del
-- animal (sacrificios.marmoleo) al que traza su lote (fecha de deshuese + Lote CC).
--
-- Qué hace el fix sin tocar datos: las pantallas (inventario de la planta, escaneos del reporte de
-- producción, traslados) y GET /api/integracion/tienda/despachos ya NO leen las columnas `bms`
-- guardadas de las cajas: calculan el BMS al leer con el marmoleo del animal (lib/bmsCaja.js). Por
-- eso lo de abajo es limpieza, no urgencia. También se quitaron los UPDATE de arranque que copiaban
-- el sufijo a `bms` (database.js / inventarioPlanta.js): sin eso, cualquier corrección se deshacía
-- en el siguiente reinicio.
--
-- Cómo se distingue lo contaminado: en estas tablas la ÚNICA fuente de `bms` de una caja era el
-- decodificador, así que toda caja con `bms` no nulo lo sacó del sufijo (y coincide con los 2
-- últimos dígitos del código). Las BOLSAS (28 caracteres) sí traen el BMS impreso: no se tocan.
--
-- Cómo usarlo: correr SOLO los SELECT (secciones 1–4). Las correcciones (sección 5) van comentadas:
-- se corren a mano, con respaldo previo de la base, UNA vez desplegado el fix (si se corren antes,
-- el arranque del código viejo las vuelve a llenar).
--
--   docker exec -i kiwi-mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" hacienda_tracking' \
--     < backend/migraciones/2026-11-07-diagnostico-bms-sufijo-caja.sql

-- 1. Líneas del inventario de la planta (cajas) con BMS = sufijo. `bms_animal` es lo que el fix
--    muestra ahora (marmoleo AUS-MEAT del animal; NULL = la caja queda sin BMS).
SELECT c.id AS carga_id, c.archivo, c.es_prueba,
       COUNT(*) AS cajas_con_bms_de_sufijo,
       SUM(l.bms = 11) AS con_11,
       SUM(s.marmoleo IS NOT NULL) AS con_marmoleo_del_animal
  FROM inventario_planta_lineas l
  JOIN inventario_planta_cargas c ON c.id = l.carga_id
  LEFT JOIN (SELECT animal_id, MAX(marmoleo) AS marmoleo FROM sacrificios WHERE marmoleo IS NOT NULL GROUP BY animal_id) s ON s.animal_id = l.animal_id
 WHERE l.bms IS NOT NULL
   AND JSON_UNQUOTE(JSON_EXTRACT(l.decodificado, '$.tipo')) IN ('caja', 'ambigua')
   AND CHAR_LENGTH(l.codigo_barras) = 25
   AND l.bms = CAST(RIGHT(l.codigo_barras, 2) AS UNSIGNED)
 GROUP BY c.id, c.archivo, c.es_prueba
 ORDER BY c.id;

-- 1b. Detalle (primeras 200) para revisar a ojo.
SELECT l.id, l.carga_id, l.codigo_barras, l.descripcion, l.bms AS bms_guardado,
       RIGHT(l.codigo_barras, 2) AS sufijo, l.arete, s.marmoleo AS bms_animal
  FROM inventario_planta_lineas l
  LEFT JOIN (SELECT animal_id, MAX(marmoleo) AS marmoleo FROM sacrificios WHERE marmoleo IS NOT NULL GROUP BY animal_id) s ON s.animal_id = l.animal_id
 WHERE l.bms IS NOT NULL
   AND JSON_UNQUOTE(JSON_EXTRACT(l.decodificado, '$.tipo')) IN ('caja', 'ambigua')
   AND CHAR_LENGTH(l.codigo_barras) = 25
 ORDER BY l.id
 LIMIT 200;

-- 2. Ítems de órdenes de salida (traslados 107 → WC-01) con BMS = sufijo de la caja. Estos son los
--    que ya pudieron viajar a la tienda como BMS: anotar los números de orden para revisar allá
--    (wagyu-demo: scripts/diagnostico-bms-caja.ts).
SELECT o.numero, o.estado, o.es_prueba, i.id AS item_id, i.codigo_barras, i.bms AS bms_guardado, i.arete
  FROM ordenes_salida_items i
  JOIN ordenes_salida o ON o.id = i.orden_id
 WHERE i.bms IS NOT NULL
   AND CHAR_LENGTH(i.codigo_barras) = 25
   AND i.bms = CAST(RIGHT(i.codigo_barras, 2) AS UNSIGNED)
 ORDER BY o.id, i.id;

-- 3. Escaneos del reporte de producción (cajas) con BMS: todos salieron del sufijo (lo copiaba el
--    insert y el UPDATE de arranque).
SELECT e.fecha_deshuese, COUNT(*) AS cajas_con_bms, SUM(e.bms = CAST(e.sufijo AS UNSIGNED)) AS bms_igual_sufijo
  FROM reporte_produccion_escaneos e
 WHERE e.tipo = 'caja' AND e.bms IS NOT NULL
 GROUP BY e.fecha_deshuese
 ORDER BY e.fecha_deshuese;

-- 4. Totales rápidos.
SELECT 'inventario_planta_lineas' AS tabla, COUNT(*) AS filas
  FROM inventario_planta_lineas l
 WHERE l.bms IS NOT NULL AND JSON_UNQUOTE(JSON_EXTRACT(l.decodificado, '$.tipo')) IN ('caja', 'ambigua') AND CHAR_LENGTH(l.codigo_barras) = 25
UNION ALL
SELECT 'ordenes_salida_items', COUNT(*) FROM ordenes_salida_items i
 WHERE i.bms IS NOT NULL AND CHAR_LENGTH(i.codigo_barras) = 25 AND i.bms = CAST(RIGHT(i.codigo_barras, 2) AS UNSIGNED)
UNION ALL
SELECT 'reporte_produccion_escaneos', COUNT(*) FROM reporte_produccion_escaneos e
 WHERE e.tipo = 'caja' AND e.bms IS NOT NULL;

-- 5. CORRECCIÓN (comentada; respaldo antes; solo con el fix ya desplegado).
--    Vacía el BMS guardado de las cajas. Lo que se muestra y lo que va a la tienda ya sale del
--    marmoleo del animal al leer, así que vaciarlo no cambia ninguna pantalla: deja la base coherente.
--
-- START TRANSACTION;
-- UPDATE inventario_planta_lineas
--    SET bms = NULL
--  WHERE bms IS NOT NULL
--    AND JSON_UNQUOTE(JSON_EXTRACT(decodificado, '$.tipo')) IN ('caja', 'ambigua')
--    AND CHAR_LENGTH(codigo_barras) = 25
--    AND bms = CAST(RIGHT(codigo_barras, 2) AS UNSIGNED);
-- UPDATE ordenes_salida_items
--    SET bms = NULL
--  WHERE bms IS NOT NULL
--    AND CHAR_LENGTH(codigo_barras) = 25
--    AND bms = CAST(RIGHT(codigo_barras, 2) AS UNSIGNED);
-- UPDATE reporte_produccion_escaneos SET bms = NULL WHERE tipo = 'caja' AND bms IS NOT NULL;
-- COMMIT;
