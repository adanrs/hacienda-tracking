// Lectura por foto (y PDF escaneado) con un modelo de visión: proveedor configurable por .env.
//
// El dueño quiere «adjunte la foto o el PDF y que el servicio haga la transcripción». La app NO
// aplica nada de lo que lea el modelo: el texto vuelve SIEMPRE a la pantalla, editable, y de ahí
// pasa por la vista previa del motor de importación como cualquier texto pegado.
//
// Configuración (sin secretos en el repo):
//   KIWI_VISION_URL    URL del servicio (p. ej. el gateway de la VM Kiwi AI: http://100.73.27.2:8898/vision)
//   KIWI_VISION_TOKEN  token que se manda en la cabecera X-Kiwi-Token
//   KIWI_VISION_TIMEOUT_MS (opcional, 150000)
// Sin URL o sin token → no disponible: la pantalla muestra «Lectura por foto no disponible».
//
// Contrato esperado del servicio (POST JSON):
//   { imagen_base64, mime, instrucciones } → { texto, dudosas?: [ "fragmento poco legible", … ] }
// OJO (05-nov-2026): el gateway de la VM hoy expone /asr y /chat (texto), todavía NO /vision. Hasta
// que se agregue ese endpoint en la VM (primer ítem del siguiente PR), esto queda listo pero apagado.
//
// Los trabajos van en una cola en memoria (uno a la vez, como el gateway): la pantalla consulta el
// estado («transcribiendo» → «listo»/«error»). Si el servidor se reinicia se pierde la cola; el
// usuario vuelve a subir la foto (nunca se aplicó nada).

const MAX_TRABAJOS = 100;
const VIDA_MS = 60 * 60 * 1000;

const INSTRUCCIONES = {
  'reporte-produccion-ciisa': 'Transcriba el «REPORTE DIARIO DE PRODUCCION» tal cual, una línea por renglón: encabezado (Fecha de Produccion, Num. Lote, Tipo Produccion, Lote CC), cada artículo como «código descripción peso KGS cajas», y el pie «Total de Cajas por el Lote # n Libras x Kilos y cajas». No invente datos: marque lo ilegible con «??».',
  'marmoleo-camara': 'De la tabla de la cámara de canales transcriba SOLO dos columnas separadas por tabulador, con encabezado: «Body no.» y «DMs (AUSMEAT)». Una fila por canal. Lo ilegible, con «??».',
  'sacrificio-ciisa': 'Transcriba la tabla del sacrificio separando columnas con tabulador, con su encabezado. Lo ilegible, con «??».',
};

let siguienteId = 1;
const trabajos = new Map();
let cola = Promise.resolve();

function configuracion() {
  const url = (process.env.KIWI_VISION_URL || '').trim();
  const token = (process.env.KIWI_VISION_TOKEN || '').trim();
  return { url, token, timeout: Number(process.env.KIWI_VISION_TIMEOUT_MS) || 150000, disponible: Boolean(url && token) };
}

function disponible() { return configuracion().disponible; }

function limpiarViejos() {
  const ahora = Date.now();
  for (const [id, t] of trabajos) if (ahora - t.creado > VIDA_MS) trabajos.delete(id);
  while (trabajos.size > MAX_TRABAJOS) trabajos.delete(trabajos.keys().next().value);
}

async function llamarProveedor({ buffer, mime, formato }) {
  const { url, token, timeout } = configuracion();
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Kiwi-Token': token },
      body: JSON.stringify({ imagen_base64: buffer.toString('base64'), mime, instrucciones: INSTRUCCIONES[formato] || INSTRUCCIONES['sacrificio-ciisa'] }),
      signal: ctl.signal,
    });
    if (!r.ok) throw new Error(`El servicio de lectura respondió ${r.status}`);
    const j = await r.json();
    const texto = typeof j.texto === 'string' ? j.texto : (typeof j.text === 'string' ? j.text : '');
    if (!texto.trim()) throw new Error('El servicio no devolvió texto');
    const dudosas = Array.isArray(j.dudosas) ? j.dudosas.filter((x) => typeof x === 'string').slice(0, 200) : [];
    // «??» que el modelo dejó en lo ilegible también cuenta como baja confianza.
    if (/\?\?/.test(texto)) dudosas.push('??');
    return { texto: texto.slice(0, 200000), dudosas };
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('La lectura por foto tardó demasiado: intente con una foto más pequeña o más nítida');
    throw e;
  } finally { clearTimeout(t); }
}

/** Encola una transcripción y devuelve su id (el resultado se consulta con estado(id)). */
function encolar({ buffer, mime, formato, nombre }) {
  if (!disponible()) { const e = new Error('Lectura por foto no disponible (falta configurar el servicio de visión)'); e.status = 503; throw e; }
  limpiarViejos();
  const id = siguienteId++;
  const trabajo = { id, formato, nombre, estado: 'en_cola', creado: Date.now(), resultado: null, error: null };
  trabajos.set(id, trabajo);
  cola = cola.then(async () => {
    trabajo.estado = 'transcribiendo';
    try { trabajo.resultado = await llamarProveedor({ buffer, mime, formato }); trabajo.estado = 'listo'; } catch (e) {
      trabajo.estado = 'error'; trabajo.error = e.message;
    }
  });
  return id;
}

function estado(id) {
  const t = trabajos.get(Number(id));
  if (!t) return null;
  return { id: t.id, formato: t.formato, nombre: t.nombre, estado: t.estado, resultado: t.resultado, error: t.error };
}

module.exports = { disponible, encolar, estado, INSTRUCCIONES, _trabajos: trabajos };
