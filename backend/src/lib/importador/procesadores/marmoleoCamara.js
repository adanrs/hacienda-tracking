// Procesador de la medición de marmoleo de la cámara de canales.
//
// Lo único que se registra por animal es DMs (AUSMEAT), entero 0–9, en `sacrificios.marmoleo`
// (la misma columna que ya usan las alertas BMS y el formulario de sacrificio). Taken at va a
// `fecha_marmoleo` y DMa (área del ojo de costilla) a `ojo_ribeye_cm2` si no había dato. Todas
// las demás columnas de la cámara se guardan tal cual en `sacrificios.marmoleo_extra` (JSON).
//
// AMARRE ESTRICTO (regla del dueño): «Body no.» = número de sacrificio (canal) + arete. La fila se
// liga sola SOLO si los dos coinciden con un mismo sacrificio registrado. Si coincide uno solo,
// es ERROR: se muestra el candidato y el usuario lo tiene que confirmar a mano, fila por fila
// (opciones.confirmaciones[fila] = id del sacrificio); queda además en el reporte para la planta.
//
// Conversión a la etiqueta CIISA: la etiqueta de 28 caracteres trae el marmoleo en las posiciones
// 27–28 con rango 01–12 (lib/etiquetas.js). La cámara entrega AUS-MEAT 0–9. Mientras no se
// confirme la escala de la etiqueta, se compara el número tal cual (AUS-MEAT = etiqueta) y un
// valor de etiqueta > 9 se informa como «escala BMS, no comparable» (ver compararConEtiqueta).

const { marcas, fmtFechaSql, fechaTexto, claveArete } = require('../comun');

const DIAS_ATRAS = 30; // la medición se hace días después del sacrificio, no meses

/** Separa «5111 17DKF» en { canal: '5111', arete: '17DKF' }. */
function separarBody(texto) {
  const m = String(texto || '').trim().toUpperCase().match(/^([0-9A-Z-]{1,10})\s+([0-9A-Z][0-9A-Z -]*)$/);
  return m ? { canal: m[1], arete: m[2].replace(/\s+/g, '') } : null;
}

/** Compara el marmoleo AUS-MEAT medido con el de una etiqueta CIISA (01–12). */
function compararConEtiqueta(ausmeat, etiqueta) {
  if (ausmeat == null || etiqueta == null) return { comparable: false };
  if (etiqueta > 9) return { comparable: false, aviso: `La etiqueta trae marmoleo ${etiqueta} (escala BMS 1–12): no se puede comparar con AUS-MEAT ${ausmeat} sin la tabla de conversión` };
  if (Number(etiqueta) !== Number(ausmeat)) return { comparable: true, coincide: false, aviso: `Marmoleo de la etiqueta ${etiqueta} distinto del medido en la canal (AUS-MEAT ${ausmeat})` };
  return { comparable: true, coincide: true };
}

async function planificar(conn, tabla, opciones = {}) {
  const confirmaciones = opciones.confirmaciones && typeof opciones.confirmaciones === 'object' ? opciones.confirmaciones : {};
  const filas = tabla.filas.map(f => {
    const errores = [...f.errores];
    const avisos = [];
    const body = separarBody(f.valores.body);
    if (!f.valores.body) errores.push('Body no. vacío');
    else if (!body) errores.push(`Body no. «${f.valores.body}» no tiene el formato «canal arete» (p. ej. 5111 17DKF)`);
    if (f.valores.barcode && f.valores.body && f.valores.barcode.replace(/\s+/g, ' ').trim().toUpperCase() !== f.valores.body.replace(/\s+/g, ' ').trim().toUpperCase()) {
      avisos.push(`Barcode no. (${f.valores.barcode}) distinto de Body no. (${f.valores.body}): se usa Body no.`);
    }
    const a = String(f.valores.ausmeat ?? '').trim();
    let ausmeat = null;
    if (a === '') errores.push('DMs (AUSMEAT) vacío');
    else if (!/^\d{1,2}$/.test(a) || Number(a) > 9) errores.push(`DMs (AUSMEAT) «${a}» debe ser un entero de 0 a 9`);
    else ausmeat = Number(a);
    return { fila: f.fila, v: f.valores, body, ausmeat, errores, avisos, extras: f.extras || {} };
  });

  // Candidatos: sacrificios por número de canal o por arete (en ventana razonable).
  const canales = [...new Set(filas.filter(f => f.body).map(f => f.body.canal))];
  const aretes = [...new Set(filas.filter(f => f.body).map(f => f.body.arete))];
  let sacrif = [];
  if (canales.length || aretes.length) {
    const cond = [];
    const params = [];
    if (canales.length) { cond.push(`UPPER(s.numero_canal) IN (${marcas(canales.length)})`); params.push(...canales); }
    if (aretes.length) { cond.push(`REPLACE(UPPER(a.numero_trazabilidad), ' ', '') IN (${marcas(aretes.length)})`); params.push(...aretes); }
    [sacrif] = await conn.query(
      `SELECT s.id, s.animal_id, UPPER(s.numero_canal) AS numero_canal, ${fmtFechaSql('s.fecha_dia', 'fecha')}, s.marmoleo,
              DATE_FORMAT(s.fecha_marmoleo, '%Y-%m-%d %H:%i:%s') AS fecha_marmoleo, s.ojo_ribeye_cm2, a.numero_trazabilidad
       FROM sacrificios s JOIN animales a ON a.id = s.animal_id
       WHERE (${cond.join(' OR ')}) AND s.fecha_dia >= DATE_SUB(CURDATE(), INTERVAL 400 DAY)
       ORDER BY s.fecha DESC`, params);
  }
  const porId = new Map(sacrif.map(s => [s.id, s]));

  const discrepancias = [];
  const usados = new Map();
  const salida = filas.map((f) => {
    const item = { fila: f.fila, entidad: 'marmoleo', clave: f.v.body || '', body: f.v.body, ausmeat: f.ausmeat, tomado_en: f.v.taken_at, accion: 'error', cambios: [], errores: f.errores, avisos: f.avisos, acciones: [], extras: f.extras };
    if (!f.body) return item;
    const { canal, arete } = f.body;
    // Si la fecha de la medición viene, solo sirven sacrificios del mismo día o hasta 30 días antes.
    const enVentana = (s) => !f.v.taken_at || (s.fecha <= f.v.taken_at.slice(0, 10) && s.fecha >= restarDias(f.v.taken_at.slice(0, 10), DIAS_ATRAS));
    const ambos = sacrif.filter(s => s.numero_canal === canal && claveArete(s.numero_trazabilidad) === claveArete(arete) && enVentana(s));
    let s = ambos[0] || null;
    if (!s) {
      const porCanal = sacrif.filter(x => x.numero_canal === canal && enVentana(x));
      const porArete = sacrif.filter(x => claveArete(x.numero_trazabilidad) === claveArete(arete));
      const candidatos = [...new Map([...porCanal, ...porArete].map(x => [x.id, x])).values()];
      item.candidatos = candidatos.map(x => ({ sacrificio_id: x.id, canal: x.numero_canal, arete: x.numero_trazabilidad, fecha: x.fecha, coincide: x.numero_canal === canal ? 'canal' : 'arete' }));
      const confirmado = confirmaciones[String(f.fila)] != null ? Number(confirmaciones[String(f.fila)]) : null;
      if (confirmado && candidatos.some(x => x.id === confirmado)) {
        s = porId.get(confirmado);
        item.confirmado = true;
        item.avisos.push(`Ligado a mano: la cámara dice ${canal} ${arete}, el sacrificio es canal ${s.numero_canal} · ${s.numero_trazabilidad}`);
      } else if (candidatos.length) {
        item.errores.push(`No coinciden número de sacrificio y arete a la vez (${canal} ${arete}). ${candidatos.map(x => `Canal ${x.numero_canal} es ${x.numero_trazabilidad}`).join('; ')}. Confirme a mano el correcto.`);
      } else {
        item.errores.push(`No hay sacrificio registrado con la canal ${canal} ni con el arete ${arete}`);
      }
      if (candidatos.length) discrepancias.push(`Medición «${f.v.body}»: ${candidatos.map(x => `la canal ${x.numero_canal} corresponde a ${x.numero_trazabilidad}`).join('; ')}.`);
      else discrepancias.push(`Medición «${f.v.body}»: no corresponde a ninguna canal sacrificada.`);
    }
    if (!s) return item;

    item.sacrificio_id = s.id;
    item.animal_id = s.animal_id;
    item.canal = s.numero_canal;
    item.arete = s.numero_trazabilidad;
    item.fecha_sacrificio = s.fecha;
    if (f.v.taken_at && f.v.taken_at.slice(0, 10) < s.fecha) item.errores.push(`La medición (${fechaTexto(f.v.taken_at.slice(0, 10))}) es anterior al sacrificio (${fechaTexto(s.fecha)})`);
    if (usados.has(s.id)) item.errores.push(`La canal ${s.numero_canal} ya se midió en la fila ${usados.get(s.id)}`);
    else usados.set(s.id, f.fila);
    if (s.marmoleo != null && f.ausmeat != null && Number(s.marmoleo) !== f.ausmeat) item.cambios.push({ campo: 'marmoleo', etiqueta: 'Marmoleo AUS-MEAT', antes: s.marmoleo, despues: f.ausmeat });
    item.datos = {
      marmoleo: f.ausmeat, fecha_marmoleo: f.v.taken_at || null, dma: f.v.dma ?? null,
      extra: { dmp: f.v.dmp ?? null, nfi2: f.v.nfi2 ?? null, dma: f.v.dma ?? null, dms: f.v.dms ?? null, dms_msa: f.v.dms_msa ?? null, dmc: f.v.dmc ?? null, barcode: f.v.barcode || null, body: f.v.body, ...f.extras },
    };
    if (item.errores.length) item.accion = 'error';
    else if (s.marmoleo == null) item.accion = 'nuevo';
    else if (item.cambios.length || (f.v.taken_at && f.v.taken_at !== s.fecha_marmoleo)) item.accion = 'actualizar';
    else item.accion = 'sin_cambios';
    return item;
  });

  const reporte = discrepancias.length
    ? ['Medición de marmoleo — revisión contra los sacrificios registrados (Wagyu Cross)', '', 'Diferencias encontradas:', ...discrepancias.map(d => `- ${d}`), '', 'Por favor confirmar número de sacrificio y arete. Gracias.'].join('\n')
    : null;
  return { filas: salida, discrepancias, reporte_planta: reporte, resumen: { discrepancias: discrepancias.length } };
}

function restarDias(iso, dias) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10);
}

async function aplicar(conn, plan, { importacionId, registrar }) {
  let n = 0;
  for (const it of plan.filas) {
    if (it.accion === 'error' || it.accion === 'sin_cambios') {
      if (it.accion === 'sin_cambios') registrar(it.fila, 'marmoleo', it.sacrificio_id, 'sin_cambios', null);
      continue;
    }
    await conn.query(
      `UPDATE sacrificios SET marmoleo = ?, fecha_marmoleo = COALESCE(?, fecha_marmoleo, NOW()),
         ojo_ribeye_cm2 = COALESCE(ojo_ribeye_cm2, ?), marmoleo_extra = ?, marmoleo_importacion_id = ?
       WHERE id = ?`,
      [it.datos.marmoleo, it.datos.fecha_marmoleo, it.datos.dma, JSON.stringify(it.datos.extra), importacionId, it.sacrificio_id]);
    registrar(it.fila, 'marmoleo', it.sacrificio_id, it.accion === 'nuevo' ? 'creado' : 'actualizado', { canal: it.canal, arete: it.arete, marmoleo: it.datos.marmoleo, confirmado: !!it.confirmado, cambios: it.cambios });
    n++;
  }
  return { resumen: { mediciones: n }, reporte_planta: plan.reporte_planta };
}

module.exports = { planificar, aplicar, separarBody, compararConEtiqueta };
