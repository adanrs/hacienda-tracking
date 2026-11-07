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
// El gateway /vision (VM Kiwi AI, Nemotron VL) ya está en producción (06-nov-2026). Solo acepta
// imágenes (un PDF escaneado responde 415: la pantalla pide una foto por página) y un trabajo a la vez.
//
// Los trabajos van en una cola en memoria (uno a la vez, como el gateway): la pantalla consulta el
// estado («transcribiendo» → «listo»/«error»). Si el servidor se reinicia se pierde la cola; el
// usuario vuelve a subir la foto (nunca se aplicó nada).

const MAX_TRABAJOS = 100;
const VIDA_MS = 60 * 60 * 1000;

// Instrucciones por formato para el modelo de visión (el gateway corta a 2000 caracteres). Cada una
// pide la tabla con columnas separadas por TABULADOR y los mismos encabezados que entiende el lector
// del importador (formatos.js), así el texto leído pasa por el MISMO procesador que el archivo o el
// pegado. «??» marca lo ilegible: el motor marca esa fila «leído por foto: revisar» (motor.js).
const COMUN = ' Copie números, aretes y códigos exactamente, carácter por carácter (distinga 0/O, 1/I, 5/S, 8/B); no redondee, no sume, no complete ni invente datos. Lo ilegible, con «??». Devuelva solo el texto, sin comentarios ni formato Markdown.';
const INSTRUCCIONES = {
  'reporte-produccion-ciisa': 'Transcriba el «REPORTE DIARIO DE PRODUCCION» tal cual, una línea por renglón: encabezado (Fecha de Produccion, Num. Lote, Tipo Produccion, Lote CC), cada artículo como «código descripción peso KGS cajas», y el pie «Total de Cajas por el Lote # n Libras x Kilos y cajas».' + COMUN,
  'marmoleo-camara': 'De la tabla de la cámara de canales transcriba SOLO dos columnas separadas por tabulador, con encabezado: «Body no.» y «DMs (AUSMEAT)». Una fila por canal. «Body no.» completo: número de canal, espacio y arete (p. ej. «5111 17DKF»).' + COMUN,
  'sacrificio-ciisa': 'Es el correo de la planta CIISA «Sacrificio Wagyu dd-mm-aa». Primera línea: el asunto tal cual (p. ej. «Sacrificio Wagyu 15-10-26»). Luego la tabla con las columnas separadas por TABULADOR: una primera fila de encabezados en UNA sola línea: Cantidad, Número de canal, Sexo, Peso pie (kg), Peso canal (kg), Rendimiento %, Arete, Musculo, Dientes, Grasa, Golpe; después una fila por canal con sus valores en ese orden. Un guion «-» se copia como «-». Omita saludos, firmas y el resto del correo.' + COMUN,
  'ganadero-sg': 'Es el reporte «Sistematización de Hatos» de Software GANADERO SG (salida de animales). Primero copie, una por línea, la línea de la finca (p. ej. «01-003 - ENGORDE WAGYU»), «Actualizado a: dd/mm/aa» e «Impresión: …». NO copie la leyenda de abreviaturas (las líneas con «=»). Luego la tabla con las columnas separadas por TABULADOR: primera fila = encabezados con su nombre completo (Número, Sexo, E.Mes, F. Nto, Raza, # Madre, # Padre, Pot., I.E., Días pot., U.Peso, gr/día/vida, FUV, UV, Fec. salida, Causa salida, Tipo Dest, Obs. salida, Peso sal., Vendido a; solo las que aparezcan) y después una fila por animal. Fechas tal cual (3/14/2024). El I.E. completo sin espacios. Una celda vacía queda vacía entre dos tabuladores.' + COMUN,
  'inventario-ciisa': 'Es el inventario semanal de la planta CIISA (hoja «INV GENERAL» o «MADURACION»). Transcriba la tabla con las columnas separadas por TABULADOR: primera fila = encabezados tal cual aparecen (INV GENERAL: Tarima, Linea, Cod Barra, Codigo, Descripción, Peso, Medida, Lote, Fecha Vencimiento, Vencido, Despacho, Fecha despacho, Pedido por, Orden; MADURACION: TARIMA, CODIGO, DESCRIPCION, LOTE, CAJA, PESO, FECHA DE VENCIMIENTO FRESCO, ESTATUS), después una fila por línea del inventario. El código de barras completo sin espacios (suele tener 25 caracteres; si trae «xxx», cópielo igual). Peso con punto decimal. Una celda vacía queda vacía entre dos tabuladores.' + COMUN,
  'solicitud-deshuese-excel': 'Es una «Solicitud de Deshuese» de CIISA: canales en columnas y cortes en filas. Primera línea: «Deshuese ddmmaa» con la fecha del sacrificio (p. ej. «Deshuese 151026»). Después, con las columnas separadas por TABULADOR, una línea por dato: la etiqueta y luego un valor por canal, en el orden de las columnas: «Canal #» (Canal # 1, Canal # 2…), «Arete», «Sexo», «Padre», «Peso en Pie», «Peso Pie Planta», «Peso canal», «Consecutivo Mes Sacrificio», «Lote de Deshuese», «Marble Score». Luego una línea que diga solo «Codigo» y debajo una línea por corte: código de 5 dígitos, TAB, nombre del corte, TAB y la cantidad de medias (0, 1 o 2) de cada canal en el mismo orden. Corte sin código: primera columna vacía. No copie los totales ni el cálculo de proceso de abajo.' + COMUN,
  'catalogo-cortes': 'Es un listado de cortes. Transcriba la tabla con las columnas separadas por TABULADOR: primera fila de encabezados (Codigo, Descripcion y, si aparecen, Tipo, Unidad, Activo), después una fila por corte. El código tiene 5 dígitos.' + COMUN,
};

let siguienteId = 1;
const trabajos = new Map();
let cola = Promise.resolve();

function configuracion() {
  const url = (process.env.KIWI_VISION_URL || '').trim();
  const token = (process.env.KIWI_VISION_TOKEN || '').trim();
  return { url, token, timeout: Number(process.env.KIWI_VISION_TIMEOUT_MS) || 150000, disponible: Boolean(url && token) };
}

/** Instrucciones del formato; uno sin instrucciones propias pide una transcripción genérica por tabulador. */
function instruccionesDe(formato) {
  return INSTRUCCIONES[formato] || ('Transcriba la tabla del documento con las columnas separadas por TABULADOR, con su fila de encabezados.' + COMUN);
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
      body: JSON.stringify({ imagen_base64: buffer.toString('base64'), mime, instrucciones: instruccionesDe(formato) }),
      signal: ctl.signal,
    });
    // Mensajes que el usuario entienda: el gateway solo acepta imágenes y lee una a la vez.
    if (r.status === 415) throw new Error('El servicio de lectura solo acepta fotos (JPG, PNG o WEBP): tome una foto de cada página');
    if (r.status === 503) throw new Error('El servicio de lectura está ocupado: intente de nuevo en un minuto');
    if (r.status === 413) throw new Error('La foto es demasiado grande para el servicio de lectura');
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
function encolar({ buffer, mime, formato, nombre, usuarioId }) {
  if (!disponible()) { const e = new Error('Lectura por foto no disponible (falta configurar el servicio de visión)'); e.status = 503; throw e; }
  limpiarViejos();
  const id = siguienteId++;
  const trabajo = { id, formato, nombre, usuarioId: usuarioId || null, estado: 'en_cola', creado: Date.now(), resultado: null, error: null };
  trabajos.set(id, trabajo);
  cola = cola.then(async () => {
    trabajo.estado = 'transcribiendo';
    try { trabajo.resultado = await llamarProveedor({ buffer, mime, formato }); trabajo.estado = 'listo'; } catch (e) {
      trabajo.estado = 'error'; trabajo.error = e.message;
    }
  });
  return id;
}

/** Estado de una transcripción: solo para quien la pidió o un admin (el texto puede ser sensible). */
function estado(id, usuario = {}) {
  const t = trabajos.get(Number(id));
  if (!t) return null;
  if (usuario.rol !== 'admin' && t.usuarioId !== (usuario.id || null)) return null;
  return { id: t.id, formato: t.formato, nombre: t.nombre, estado: t.estado, resultado: t.resultado, error: t.error };
}

module.exports = { disponible, encolar, estado, INSTRUCCIONES, instruccionesDe, _trabajos: trabajos };
