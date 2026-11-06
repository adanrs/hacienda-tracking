// Autenticación servicio a servicio para /api/integracion/tienda/* (tienda → ganadería).
//
// Va FUERA del JWT de usuarios: la tienda no tiene usuario de la app. Orden de los chequeos, a
// propósito:
//   1. Cloudflare → 404. La tienda llama por la red docker interna (kiwi_internal) a
//      http://kiwi-hacienda-backend:8001 y esas peticiones nunca traen cabeceras cf-*. Si llegan,
//      la petición vino de internet por el túnel: se responde como si la ruta no existiera, antes
//      de revelar el modo o si hay secreto.
//   2. Interruptor INTEGRACION_TIENDA_MODO=apagado → 503 (se reintenta, no se pierde nada).
//   3. Sin secreto válido o sin usuario de servicio → 503 (configuración incompleta).
//   4. Firma HMAC + ventana de ±5 min → 401.
// Si todo pasa, req.user = usuario técnico `integracion.tienda` (rol servicio): los movimientos
// futuros necesitan un usuario_id NOT NULL.

const { verificar, cargarClaves } = require('../lib/integracion/firma');

const CABECERAS_CLOUDFLARE = ['cf-ray', 'cf-connecting-ip', 'cf-ipcountry', 'cf-visitor'];
// «pruebas» (06-nov-2026): como encendido, pero solo con datos marcados PRUEBA (órdenes es_prueba):
// sirve para recorrer el flujo completo en producción sin tocar traslados reales.
const MODOS = ['apagado', 'sombra', 'pruebas', 'encendido'];

/** Modo vigente. Un valor desconocido cuenta como apagado (falla cerrada). */
function modoIntegracion(env = process.env) {
  const m = String(env.INTEGRACION_TIENDA_MODO || 'apagado').trim().toLowerCase();
  return MODOS.includes(m) ? m : 'apagado';
}

function vieneDeCloudflare(req) {
  if (CABECERAS_CLOUDFLARE.some(h => req.headers[h] !== undefined)) return true;
  // cdn-loop lo usan otros CDN también; solo cuenta si dice cloudflare.
  return /cloudflare/i.test(String(req.headers['cdn-loop'] || ''));
}

/**
 * @param opciones.buscarUsuarioServicio async () => id | null  (inyectable en las pruebas)
 * @param opciones.env                    fuente de variables (process.env por omisión)
 * @param opciones.ahora                  () => epoch ms (inyectable en las pruebas)
 */
function crearFirmaServicio({ buscarUsuarioServicio, env = process.env, ahora = () => Date.now() } = {}) {
  let cacheClaves = { valor: undefined, claves: new Map(), errores: [] };
  let avisado = false;
  let usuarioId = null;

  let avisoAlias = false;
  const claves = () => {
    // Nombre del diseño: INTEGRACION_TIENDA_SECRETO. INTEGRACION_TIENDA_SECRET se acepta como alias
    // (fue el nombre de la primera versión de este PR) con aviso, para no cortar un .env ya hecho.
    let valor = env.INTEGRACION_TIENDA_SECRETO;
    if ((valor === undefined || valor === '') && env.INTEGRACION_TIENDA_SECRET) {
      valor = env.INTEGRACION_TIENDA_SECRET;
      if (!avisoAlias) {
        console.warn('[integracion-tienda] INTEGRACION_TIENDA_SECRET está obsoleto: renombrarlo a INTEGRACION_TIENDA_SECRETO');
        avisoAlias = true;
      }
    }
    if (valor !== cacheClaves.valor) {
      const r = cargarClaves(valor);
      cacheClaves = { valor, ...r };
      avisado = false;
    }
    if (cacheClaves.errores.length && !avisado) {
      // Solo el motivo, nunca el valor del secreto.
      console.error(`[integracion-tienda] ${cacheClaves.errores.join('; ')}`);
      avisado = true;
    }
    return cacheClaves.claves;
  };

  return async function firmaServicio(req, res, next) {
    if (vieneDeCloudflare(req)) return res.status(404).json({ error: 'No encontrado' });

    const modo = modoIntegracion(env);
    if (modo === 'apagado') return res.status(503).json({ error: 'integracion_apagada', modo });

    const vigentes = claves();
    if (!vigentes.size) return res.status(503).json({ error: 'integracion_sin_configurar' });

    const r = verificar({
      claves: vigentes,
      idClave: req.get('x-integracion-clave'),
      fecha: req.get('x-integracion-fecha'),
      firma: req.get('x-integracion-firma'),
      metodo: req.method,
      ruta: req.originalUrl,
      cuerpo: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
      ahora: ahora(),
    });
    if (!r.ok) return res.status(401).json({ error: 'firma_invalida', motivo: r.motivo });

    if (!usuarioId) {
      try { usuarioId = await buscarUsuarioServicio(); } catch (e) {
        console.error(`[integracion-tienda] No se pudo leer el usuario de servicio: ${e.message}`);
      }
      if (!usuarioId) return res.status(503).json({ error: 'integracion_sin_usuario_servicio' });
    }
    req.user = { id: usuarioId, username: 'integracion.tienda', rol: 'servicio' };
    req.integracion = { modo, idClave: r.idClave };
    next();
  };
}

module.exports = { crearFirmaServicio, modoIntegracion, vieneDeCloudflare, MODOS };
