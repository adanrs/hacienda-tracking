// Validación común de los parámetros de ruta que son ids numéricos (:id, :primal_id, ...).
//
// Por qué: Express decodifica %2F dentro de un parámetro, así que `/api/deshuese/5%2F..%2Fx/pdf`
// llega con req.params.id = "5/../x". MySQL convierte ese texto a 5 al compararlo con una
// columna INT (la consulta "funciona"), pero el mismo valor terminaba en el nombre de archivo
// de multer y permitía escribir fuera de uploads/. Rechazar en la entrada todo id que no sea
// solo dígitos cierra eso y cualquier otro uso del id fuera del SQL.

const SOLO_DIGITOS = /^\d{1,10}$/;
const PARAMS_ID = ['id', 'primal_id', 'fuenteId', 'bodega_id'];

function validarId(req, res, next, valor, nombre) {
  if (!SOLO_DIGITOS.test(String(valor))) {
    return res.status(400).json({ error: `Parámetro ${nombre} inválido` });
  }
  next();
}

/** Registra la validación en el router para todos los parámetros de id conocidos. */
function idsNumericos(router, nombres = PARAMS_ID) {
  for (const nombre of nombres) router.param(nombre, validarId);
  return router;
}

module.exports = { idsNumericos, validarId, SOLO_DIGITOS, PARAMS_ID };
