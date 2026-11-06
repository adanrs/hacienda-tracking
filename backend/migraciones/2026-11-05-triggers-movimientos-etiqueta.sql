-- Triggers append-only del kardex movimientos_etiqueta (núcleo v10, propuesta.sql §12).
--
-- Por qué este archivo: initDB() intenta crearlos con el usuario de la app, pero con binlog
-- activo (lo normal en mysql:8.0) MySQL exige SUPER o log_bin_trust_function_creators=1 y falla
-- con ER_BINLOG_CREATE_ROUTINE_NEED_SUPER. La app no depende de ellos (nunca hace UPDATE/DELETE
-- del kardex); son la red de seguridad contra un UPDATE manual. Si el log del backend muestra
-- «[initDB:v10] trigger trg_me_no_*», correr esto UNA vez como root:
--
--   docker exec -i kiwi-mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" hacienda_tracking' \
--     < backend/migraciones/2026-11-05-triggers-movimientos-etiqueta.sql
--
-- Idempotente (DROP IF EXISTS + CREATE). Correrlo después de que el backend nuevo arrancó al
-- menos una vez (tiene que existir la tabla movimientos_etiqueta).

DROP TRIGGER IF EXISTS trg_me_no_update;
DROP TRIGGER IF EXISTS trg_me_no_delete;

DELIMITER $$
CREATE TRIGGER trg_me_no_update BEFORE UPDATE ON movimientos_etiqueta FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'movimientos_etiqueta es append-only: registre un movimiento inverso';
END$$
CREATE TRIGGER trg_me_no_delete BEFORE DELETE ON movimientos_etiqueta FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'movimientos_etiqueta es append-only';
END$$
DELIMITER ;
