// Firma HMAC-SHA256 servicio a servicio (tienda → ganadería). Contrato en
// docs/integracion-tienda/README.md §2. Puro: sin Express ni base de datos, para probarlo con
// vectores fijos que la tienda (wagyu-demo) repite en sus pruebas.
//
//   X-Integracion-Clave: id de la clave (p. ej. tienda-v1), para rotar con dos claves vigentes
//   X-Integracion-Fecha: epoch en milisegundos; se rechaza fuera de ±5 min
//   X-Integracion-Firma: hex(HMAC-SHA256(secreto, fecha \n MÉTODO \n ruta_con_query \n sha256hex(cuerpo)))
//
// `ruta_con_query` es la ruta COMPLETA que recibe ganadería (req.originalUrl), con el prefijo
// /api/integracion/tienda, tal cual se envía (sin reordenar la query).

const crypto = require('crypto');

const VENTANA_MS = 5 * 60 * 1000;
const LARGO_MINIMO_SECRETO = 32;
const ID_CLAVE_POR_OMISION = 'tienda-v1';


const sha256hex = (buf) => crypto.createHash('sha256').update(buf || Buffer.alloc(0)).digest('hex');

function cadenaCanonica({ fecha, metodo, ruta, cuerpo }) {
  return `${fecha}\n${String(metodo).toUpperCase()}\n${ruta}\n${sha256hex(cuerpo)}`;
}

function firmar({ secreto, fecha, metodo, ruta, cuerpo }) {
  return crypto.createHmac('sha256', secreto).update(cadenaCanonica({ fecha, metodo, ruta, cuerpo })).digest('hex');
}

/**
 * Lee las claves vigentes de INTEGRACION_TIENDA_SECRETO. Acepta:
 *   - un secreto solo                     → id «tienda-v1»
 *   - lista «id:secreto,id2:secreto2»     → rotación: se agrega la nueva, se migra la tienda y
 *                                           después se quita la vieja, sin cortar el servicio.
 * Devuelve { claves: Map(id → secreto), errores: string[] }. Un secreto corto se descarta
 * (con error) en vez de aceptarse: un HMAC con secreto adivinable no protege nada.
 */
function cargarClaves(valor) {
  const claves = new Map();
  const errores = [];
  const texto = String(valor || '').trim();
  if (!texto) return { claves, errores: ['INTEGRACION_TIENDA_SECRETO no está definido'] };
  const partes = texto.split(',').map(s => s.trim()).filter(Boolean);
  for (const parte of partes) {
    // El secreto es hex (openssl rand -hex 32), así que «:» solo puede separar id y secreto.
    const m = /^([A-Za-z0-9._-]{1,40}):(.+)$/.exec(parte);
    let id = null;
    let secreto = parte;
    if (m) { id = m[1]; secreto = m[2]; } else if (partes.length === 1) { id = ID_CLAVE_POR_OMISION; }
    if (!id) { errores.push('Con varias claves, cada una va como id:secreto'); continue; }
    if (secreto.length < LARGO_MINIMO_SECRETO) { errores.push(`La clave ${id} tiene menos de ${LARGO_MINIMO_SECRETO} caracteres`); continue; }
    if (claves.has(id)) { errores.push(`La clave ${id} está repetida`); continue; }
    claves.set(id, secreto);
  }
  return { claves, errores };
}

/**
 * Verifica una petición. Devuelve { ok: true, idClave } o { ok: false, motivo }.
 * El motivo es un código corto (sin detalles del secreto) para que la tienda lo muestre en su
 * panel: encabezados, clave_desconocida, fecha_fuera_de_ventana, firma.
 */
function verificar({ claves, idClave, fecha, firma, metodo, ruta, cuerpo, ahora = Date.now() }) {
  if (!idClave || !fecha || !firma) return { ok: false, motivo: 'encabezados' };
  if (!/^\d{13}$/.test(String(fecha))) return { ok: false, motivo: 'encabezados' };
  if (!/^[0-9a-f]{64}$/i.test(String(firma))) return { ok: false, motivo: 'encabezados' };
  const secreto = claves.get(String(idClave));
  if (!secreto) return { ok: false, motivo: 'clave_desconocida' };
  if (Math.abs(ahora - Number(fecha)) > VENTANA_MS) return { ok: false, motivo: 'fecha_fuera_de_ventana' };
  const esperada = Buffer.from(firmar({ secreto, fecha, metodo, ruta, cuerpo }), 'hex');
  const recibida = Buffer.from(String(firma).toLowerCase(), 'hex');
  if (esperada.length !== recibida.length || !crypto.timingSafeEqual(esperada, recibida)) {
    return { ok: false, motivo: 'firma' };
  }
  return { ok: true, idClave: String(idClave) };
}

module.exports = { firmar, verificar, cargarClaves, cadenaCanonica, sha256hex, VENTANA_MS, LARGO_MINIMO_SECRETO, ID_CLAVE_POR_OMISION };
