// Texto que vino de una FOTO (lectura por visión, lib/vision.js) en vez de un archivo o un pegado.
//
// Por qué existe: el modelo de visión puede leer mal un dígito de un arete, de un peso o de un
// número de canal sin avisar. El texto pasa por el MISMO procesador que el archivo (con sus
// validaciones de amarre contra la guía, el sacrificio o el catálogo); aquí solo se marcan las filas
// que hay que revisar contra el papel:
//   - la fila trae «??» (lo que el modelo no pudo leer) o un fragmento que el servicio reportó como
//     dudoso (`dudosas`);
//   - la fila ya tiene errores o avisos del procesador: con una foto, lo más probable es que sea una
//     mala lectura, no un dato malo del proveedor.
// No bloquea nada por sí mismo (los errores del procesador siguen frenando su fila); suma el aviso
// «Leído por foto: revisar» y la marca `revisar_foto` que la vista previa muestra en la fila.
// La pantalla manda `opciones.foto = { dudosas: [...] }` cuando el texto salió de una foto.

const MAX_DUDOSAS = 50;
const DOCUMENTO_PEGADO = 'Texto pegado'; // nombre que reporteProduccionCiisa le da al texto pegado
const AVISO = 'Leído por foto: revise este dato contra el papel (la lectura no estaba segura)';
const NOTA_REPORTE = '(Datos leídos de una foto: antes de mandar este reporte, confirme cada diferencia contra el documento original; puede ser un error de lectura y no de la planta.)';

/** Normaliza lo que llega del navegador: solo textos cortos, sin «??» (eso se busca aparte). */
function dudosasDe(foto) {
  const lista = foto && Array.isArray(foto.dudosas) ? foto.dudosas : [];
  return [...new Set(lista
    .filter((d) => typeof d === 'string')
    .map((d) => d.trim().slice(0, 60))
    .filter((d) => d.length >= 2 && d !== '??'))].slice(0, MAX_DUDOSAS);
}

/** ¿El plan se armó con texto leído por foto? */
function esFoto(opciones) {
  return Boolean(opciones && opciones.foto && typeof opciones.foto === 'object');
}

/**
 * Marca las filas del plan (muta y devuelve el plan). PURO: no toca la base.
 * Devuelve además plan.leido_por_foto = { filas_revisar } para el aviso de la pantalla.
 */
function marcarLecturaFoto(plan, opciones) {
  if (!esFoto(opciones) || !plan || !Array.isArray(plan.filas)) return plan;
  const dudosas = dudosasDe(opciones.foto);
  let revisar = 0;
  for (const f of plan.filas) {
    // Tanda mixta (reporte de producción: PDF + texto): la foto siempre llega como el texto pegado;
    // las filas que vienen de un archivo («documento» = su nombre) no se marcan.
    if (f.documento && f.documento !== DOCUMENTO_PEGADO) continue;
    f.leido_por_foto = true;
    // Se busca en los datos de la fila, no en los mensajes (un mensaje puede citar el dato leído).
    const { errores, avisos, ...datos } = f;
    const texto = JSON.stringify(datos);
    const ilegible = texto.includes('??') || dudosas.some((d) => texto.includes(d));
    const conProblemas = Boolean((errores && errores.length) || (avisos && avisos.length));
    if (ilegible || conProblemas) {
      f.revisar_foto = true;
      revisar++;
      if (ilegible) f.avisos = [...(avisos || []), AVISO];
    }
  }
  plan.leido_por_foto = { filas_revisar: revisar };
  // El reporte de discrepancias se manda a la planta: con una foto, una «diferencia» puede ser un
  // dígito mal leído y no un error de ellos. Se avisa arriba del texto para revisarlo antes de mandarlo.
  if (typeof plan.reporte_planta === 'string' && plan.reporte_planta && revisar) {
    plan.reporte_planta = `${NOTA_REPORTE}\n\n${plan.reporte_planta}`;
  }
  return plan;
}

module.exports = { marcarLecturaFoto, dudosasDe, esFoto, AVISO };
