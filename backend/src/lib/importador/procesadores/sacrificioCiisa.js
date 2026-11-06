// Procesador del correo de sacrificio de CIISA («Sacrificio Wagyu 15-10-26», Gerardo Araya).
//
// LA GUÍA DE TRANSPORTE MANDA: es el original correcto de qué animales salieron de la finca. El
// correo lo digita la planta a mano y puede traer aretes mal escritos. Por eso:
//   - cada arete se busca en las guías del envío (la elegida, o las abiertas de los 7 días previos);
//   - si no está, se propone el arete más parecido de la guía todavía sin usar (distancia de
//     edición ≤ 2: «177NFU» → «177MFU») como corrección, pero la fila queda en error hasta que
//     el usuario la CONFIRME a mano (opciones.correcciones[fila]); sin candidato es error;
//   - sexo distinto → aviso y prevalece la guía; merma peso pie vs peso de salida > 8 % → aviso;
//     rendimiento recalculado (canal / pie × 100) distinto del informado por > 0,2 puntos → aviso;
//   - canal o arete repetidos → error; animales de la guía que no vienen → pendientes.
// Al aplicar se registra un sacrificio por animal (idempotente por n.º de canal + día) ligado a la
// guía, y se arma el «reporte de discrepancias para la planta» con texto listo para enviar.

const { marcas, num, fmtFechaSql, fechaTexto, claveArete } = require('../comun');
const { distanciaEdicion, parsearFecha } = require('../texto');

const MERMA_MAX = 8; // % de diferencia aceptable entre el peso de salida de la finca y el peso pie en planta
const TOLERANCIA_RENDIMIENTO = 0.2; // puntos porcentuales
const DIAS_GUIAS = 7;
const r2 = (x) => Math.round(x * 100) / 100;

function fechaDe(opciones, meta) {
  if (opciones.fecha_sacrificio) {
    const f = parsearFecha(opciones.fecha_sacrificio, 'dmy');
    return typeof f === 'string' ? f : null;
  }
  return meta.fecha_sacrificio || null;
}

async function cargarGuias(conn, fecha, guiaId) {
  const params = [];
  let cond;
  if (guiaId) { cond = 'g.id = ?'; params.push(Number(guiaId)); } else {
    cond = "g.estado <> 'anulada' AND g.fecha_salida BETWEEN DATE_SUB(?, INTERVAL ? DAY) AND ?";
    params.push(fecha, DIAS_GUIAS, fecha);
  }
  const [lineas] = await conn.query(
    `SELECT gta.animal_id, gta.arete, gta.sexo, gta.peso_salida_kg, gta.transporte_id, g.id AS guia_id, g.numero,
            ${fmtFechaSql('g.fecha_salida', 'fecha_salida')}, a.numero_trazabilidad
     FROM guia_transporte_animales gta
     JOIN guias_transporte g ON g.id = gta.guia_id
     JOIN animales a ON a.id = gta.animal_id
     WHERE ${cond}
     ORDER BY g.fecha_salida DESC, gta.orden`, params);
  return lineas.map(l => ({ ...l, peso_salida_kg: num(l.peso_salida_kg), clave: claveArete(l.numero_trazabilidad || l.arete) }));
}

async function planificar(conn, tabla, opciones = {}) {
  const meta = tabla.metadatos || {};
  const fecha = fechaDe(opciones, meta);
  const errores_generales = [];
  if (!fecha) errores_generales.push('Indique la fecha de sacrificio (no viene en el asunto del correo).');
  const correcciones = opciones.correcciones && typeof opciones.correcciones === 'object' ? opciones.correcciones : {};

  const guia = fecha || opciones.guia_id ? await cargarGuias(conn, fecha, opciones.guia_id) : [];
  const porClave = new Map();
  for (const l of guia) if (!porClave.has(l.clave)) porClave.set(l.clave, l); // la guía más reciente primero

  // Sacrificios ya registrados: por canal del día (idempotencia) y por animal (uno por animal).
  const canales = tabla.filas.map(f => f.valores.numero_canal).filter(Boolean).map(String);
  let porCanal = [];
  if (fecha && canales.length) {
    [porCanal] = await conn.query(
      `SELECT s.id, s.animal_id, s.numero_canal, a.numero_trazabilidad FROM sacrificios s JOIN animales a ON a.id = s.animal_id
       WHERE s.fecha_dia = ? AND s.numero_canal IN (${marcas(canales.length)})`, [fecha, ...canales]);
  }

  const filas = tabla.filas.map(f => ({ fila: f.fila, v: f.valores, errores: [...f.errores], avisos: [] }));
  const salida = [];
  const usados = new Set();
  const canalesVistos = new Map();
  const discrepancias = [];

  // Primera pasada: aretes que sí están en la guía (para que la propuesta solo use los libres).
  for (const f of filas) {
    const corr = correcciones[String(f.fila)];
    const arete = corr != null && String(corr).trim() !== '' ? claveArete(corr) : claveArete(f.v.arete);
    f.areteBuscado = arete;
    f.corregidoPorUsuario = corr != null && String(corr).trim() !== '' && claveArete(corr) !== claveArete(f.v.arete);
    if (porClave.has(arete)) { f.linea = porClave.get(arete); }
  }
  for (const f of filas) if (f.linea) usados.add(f.linea.clave);

  const animalesIds = [...new Set(guia.map(l => l.animal_id))];
  let sacrifPorAnimal = [];
  if (animalesIds.length) {
    [sacrifPorAnimal] = await conn.query(
      `SELECT id, animal_id, numero_canal, ${fmtFechaSql('fecha_dia', 'fecha')} FROM sacrificios WHERE animal_id IN (${marcas(animalesIds.length)})`, animalesIds);
  }

  for (const f of filas) {
    const v = f.v;
    const item = { fila: f.fila, entidad: 'sacrificio', clave: String(v.numero_canal || ''), numero_canal: v.numero_canal ? String(v.numero_canal) : null, arete_informado: v.arete, accion: 'nuevo', cambios: [], errores: f.errores, avisos: f.avisos, acciones: [] };
    salida.push(item);
    if (!v.numero_canal) item.errores.push('Número de canal vacío');
    else if (!/^[0-9A-Z-]{1,10}$/i.test(String(v.numero_canal))) item.errores.push(`Número de canal «${v.numero_canal}» inválido`);
    else if (canalesVistos.has(String(v.numero_canal))) item.errores.push(`Canal ${v.numero_canal} repetida (también en la fila ${canalesVistos.get(String(v.numero_canal))})`);
    else canalesVistos.set(String(v.numero_canal), f.fila);
    if (!v.arete) item.errores.push('Arete vacío');

    // Resolver el animal contra la guía.
    let linea = f.linea;
    if (!linea && v.arete && guia.length) {
      const libres = guia.filter(l => !usados.has(l.clave));
      const candidatos = libres.map(l => ({ l, d: distanciaEdicion(f.areteBuscado, l.clave, 2) })).filter(x => x.d <= 2).sort((a, b) => a.d - b.d);
      if (candidatos.length && (candidatos.length === 1 || candidatos[0].d < candidatos[1].d)) {
        // Se PROPONE pero no se liga solo: el dueño exige confirmar a mano cada arete corregido
        // (un animal mal ligado arrastra el error a primales, cajas y etiquetas).
        const propuesta = candidatos[0].l;
        usados.add(propuesta.clave);
        item.correccion = { informado: v.arete, propuesto: propuesta.numero_trazabilidad, distancia: candidatos[0].d };
        item.errores.push(`Posible error de digitación de la planta: ${v.arete} → ¿${propuesta.numero_trazabilidad}? Confírmelo (o escriba el correcto) para registrar esta canal`);
        discrepancias.push(`Canal ${v.numero_canal}: el arete ${v.arete} no está en la guía ${propuesta.numero}; corresponde a ${propuesta.numero_trazabilidad} (posible error de digitación).`);
      } else if (candidatos.length > 1) {
        item.errores.push(`Arete ${v.arete} no está en la guía; podría ser ${candidatos.filter(c => c.d === candidatos[0].d).map(c => c.l.numero_trazabilidad).join(' o ')}: escriba el correcto`);
        discrepancias.push(`Canal ${v.numero_canal}: el arete ${v.arete} no está en la guía (¿${candidatos.filter(c => c.d === candidatos[0].d).map(c => c.l.numero_trazabilidad).join(' o ')}?).`);
      } else {
        item.errores.push(`Arete ${f.corregidoPorUsuario ? f.areteBuscado : v.arete} no está en ${opciones.guia_id ? 'la guía elegida' : `las guías de los últimos ${DIAS_GUIAS} días`} y no hay uno parecido`);
        discrepancias.push(`Canal ${v.numero_canal}: el arete ${v.arete} no corresponde a ningún animal enviado.`);
      }
    } else if (!linea && v.arete) {
      item.errores.push(fecha ? `No hay guía de transporte en los ${DIAS_GUIAS} días previos al ${fechaTexto(fecha)}: importe primero el reporte de Ganadero SG` : 'Sin fecha no se puede buscar la guía');
    }
    if (linea && f.corregidoPorUsuario) {
      item.correccion = { informado: v.arete, propuesto: linea.numero_trazabilidad, confirmado: true };
      item.avisos.push(`Arete confirmado a mano: la planta escribió ${v.arete}, es ${linea.numero_trazabilidad}`);
      discrepancias.push(`Canal ${v.numero_canal}: el arete ${v.arete} no está en la guía ${linea.numero}; corresponde a ${linea.numero_trazabilidad} (posible error de digitación).`);
    }

    if (linea) {
      item.animal_id = linea.animal_id;
      item.arete = linea.numero_trazabilidad;
      item.guia = { id: linea.guia_id, numero: linea.numero, fecha_salida: linea.fecha_salida };
      if (v.sexo && linea.sexo && v.sexo !== linea.sexo) {
        item.avisos.push(`Sexo informado ${v.sexo === 'macho' ? 'M' : 'H'}, la guía dice ${linea.sexo === 'macho' ? 'M' : 'H'}: prevalece la guía`);
        discrepancias.push(`Canal ${v.numero_canal} (${linea.numero_trazabilidad}): sexo informado ${v.sexo === 'macho' ? 'M' : 'H'}, según la guía es ${linea.sexo === 'macho' ? 'M' : 'H'}.`);
      }
      if (v.peso_pie != null && linea.peso_salida_kg) {
        item.merma_pct = r2(((linea.peso_salida_kg - v.peso_pie) / linea.peso_salida_kg) * 100);
        item.peso_salida_kg = linea.peso_salida_kg;
        if (item.merma_pct > MERMA_MAX) item.avisos.push(`Merma ${item.merma_pct} % (salida ${linea.peso_salida_kg} kg → pie ${v.peso_pie} kg) mayor a ${MERMA_MAX} %`);
        if (item.merma_pct < -2) item.avisos.push(`Pesó más en planta que en la finca (${linea.peso_salida_kg} → ${v.peso_pie} kg)`);
      }
      if (fecha && linea.fecha_salida > fecha) item.errores.push(`La guía ${linea.numero} sale el ${fechaTexto(linea.fecha_salida)}, después del sacrificio`);
    }

    // Pesos y rendimiento.
    if (v.peso_pie != null && (v.peso_pie < 150 || v.peso_pie > 1500)) item.errores.push(`Peso pie ${v.peso_pie} kg fuera de rango`);
    if (v.peso_canal != null && (v.peso_canal < 50 || v.peso_canal > 1000)) item.errores.push(`Peso canal ${v.peso_canal} kg fuera de rango`);
    if (v.peso_pie != null && v.peso_canal != null && v.peso_canal >= v.peso_pie) item.errores.push('Peso canal mayor o igual al peso pie');
    if (v.peso_pie && v.peso_canal) {
      item.rendimiento_calculado = r2((v.peso_canal / v.peso_pie) * 100);
      if (v.rendimiento != null && Math.abs(item.rendimiento_calculado - v.rendimiento) > TOLERANCIA_RENDIMIENTO) {
        item.avisos.push(`Rendimiento informado ${v.rendimiento} %, calculado ${item.rendimiento_calculado} %`);
        discrepancias.push(`Canal ${v.numero_canal}: rendimiento informado ${v.rendimiento} %, con los pesos da ${item.rendimiento_calculado} %.`);
      }
    }
    for (const [campo, nombre, max] of [['musculo', 'Músculo', 9], ['dientes', 'Dientes', 8], ['grasa', 'Grasa', 9]]) {
      if (v[campo] != null && (v[campo] < 0 || v[campo] > max)) item.avisos.push(`${nombre} ${v[campo]} fuera de lo normal (0–${max})`);
    }
    const golpe = v.golpe && !/^[-–—]+$/.test(String(v.golpe).trim()) && !/^(no|sin golpe|ninguno)$/i.test(String(v.golpe).trim()) ? String(v.golpe).trim() : null;

    item.datos = {
      animal_id: item.animal_id || null, guia_id: item.guia ? item.guia.id : null, numero_canal: item.numero_canal,
      fecha, peso_vivo: v.peso_pie, peso_canal_caliente: v.peso_canal, rendimiento_canal: item.rendimiento_calculado ?? null,
      rendimiento_informado: v.rendimiento, musculo: v.musculo, denticion: v.dientes, grasa: v.grasa, golpe,
    };

    // Idempotencia: canal + día ya registrada.
    const ex = item.numero_canal ? porCanal.find(s => String(s.numero_canal).toUpperCase() === item.numero_canal.toUpperCase()) : null;
    if (ex && item.animal_id && ex.animal_id !== item.animal_id) {
      item.errores.push(`La canal ${item.numero_canal} del ${fechaTexto(fecha)} ya está registrada para ${ex.numero_trazabilidad}`);
    }
    const delAnimal = item.animal_id ? sacrifPorAnimal.find(s => s.animal_id === item.animal_id) : null;
    if (delAnimal && delAnimal.fecha !== fecha) {
      item.errores.push(`${item.arete} ya tiene sacrificio el ${fechaTexto(delAnimal.fecha)} (canal ${delAnimal.numero_canal || 's/n'})`);
    } else if (delAnimal && delAnimal.numero_canal && item.numero_canal && delAnimal.numero_canal.toUpperCase() !== item.numero_canal.toUpperCase() && !(ex && ex.animal_id !== item.animal_id)) {
      item.cambios.push({ campo: 'numero_canal', etiqueta: 'N.º de canal', antes: delAnimal.numero_canal, despues: item.numero_canal });
    }
    item.sacrificio_id = delAnimal ? delAnimal.id : null;
    if (item.errores.length) item.accion = 'error';
    else if (delAnimal) item.accion = 'actualizar';
  }

  // Arete repetido (después de las correcciones): error en las dos filas.
  const porAnimal = new Map();
  for (const it of salida) {
    if (!it.animal_id) continue;
    if (porAnimal.has(it.animal_id)) {
      const otra = porAnimal.get(it.animal_id);
      for (const x of [otra, it]) { x.errores.push(`Arete ${it.arete} repetido (filas ${otra.fila} y ${it.fila})`); x.accion = 'error'; }
      discrepancias.push(`Arete ${it.arete} aparece en las canales ${otra.numero_canal} y ${it.numero_canal}.`);
    } else porAnimal.set(it.animal_id, it);
  }

  // Animales enviados que no aparecen en el sacrificio (de las guías que sí aparecen).
  const guiasUsadas = new Set(salida.filter(s => s.guia).map(s => s.guia.id));
  const pendientes = guia
    .filter(l => guiasUsadas.has(l.guia_id) && !porAnimal.has(l.animal_id) && !sacrifPorAnimal.some(s => s.animal_id === l.animal_id))
    .map(l => ({ arete: l.numero_trazabilidad, guia: l.numero, peso_salida_kg: l.peso_salida_kg }));
  if (pendientes.length) discrepancias.push(`Animales enviados que no vienen en el reporte: ${pendientes.map(p => p.arete).join(', ')}.`);

  const reporte = textoReporte(fecha, discrepancias, salida);
  return {
    filas: salida,
    errores_generales,
    fecha_sacrificio: fecha,
    guias_consideradas: [...new Map(guia.map(l => [l.guia_id, { id: l.guia_id, numero: l.numero, fecha_salida: l.fecha_salida }])).values()],
    pendientes,
    discrepancias,
    reporte_planta: reporte,
    resumen: { pendientes: pendientes.length, discrepancias: discrepancias.length },
  };
}

function textoReporte(fecha, discrepancias, filas) {
  const lineas = [`Sacrificio Wagyu ${fechaTexto(fecha)} — revisión contra la guía de transporte (Wagyu Cross)`, ''];
  if (!discrepancias.length) lineas.push('Sin diferencias: todos los aretes, sexos y rendimientos coinciden con la guía.');
  else { lineas.push('Diferencias encontradas:'); for (const d of discrepancias) lineas.push(`- ${d}`); }
  const ok = filas.filter(f => f.accion !== 'error').length;
  lineas.push('', `Canales recibidas: ${filas.length}; registradas sin problema: ${ok}.`);
  lineas.push('Por favor confirmar o corregir los aretes señalados. Gracias.');
  return lineas.join('\n');
}

async function aplicar(conn, plan, { importacionId, registrar }) {
  const res = { sacrificios_nuevos: 0, sacrificios_actualizados: 0 };
  for (const it of plan.filas) {
    if (it.accion === 'error') continue;
    const d = it.datos;
    const valores = [d.peso_vivo, d.peso_canal_caliente, d.rendimiento_canal, d.musculo, d.denticion, d.grasa, d.golpe,
      d.numero_canal ? d.numero_canal.toUpperCase() : null, d.guia_id, d.rendimiento_informado, importacionId];
    if (it.sacrificio_id) {
      await conn.query(
        `UPDATE sacrificios SET fecha = ?, peso_vivo = ?, peso_canal_caliente = ?, rendimiento_canal = COALESCE(IF(peso_canal_frio IS NULL, ?, rendimiento_canal), rendimiento_canal),
           musculo = ?, denticion = ?, grasa = ?, golpe = ?, numero_canal = ?, guia_id = ?, rendimiento_informado = ?, importacion_id = ?
         WHERE id = ?`, [`${d.fecha} 00:00:00`, ...valores, it.sacrificio_id]);
      registrar(it.fila, 'sacrificio', it.sacrificio_id, 'actualizado', { canal: d.numero_canal, arete: it.arete, cambios: it.cambios });
      res.sacrificios_actualizados++;
    } else {
      const [r] = await conn.query(
        `INSERT INTO sacrificios (animal_id, fecha, peso_vivo, peso_canal_caliente, rendimiento_canal, musculo, denticion, grasa, golpe,
                                  numero_canal, guia_id, rendimiento_informado, importacion_id, resultado_inspeccion, notas)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'aprobado', ?)`,
        [d.animal_id, `${d.fecha} 00:00:00`, ...valores, it.correccion ? `Arete informado por la planta: ${it.correccion.informado}` : null]);
      registrar(it.fila, 'sacrificio', r.insertId, 'creado', { canal: d.numero_canal, arete: it.arete, correccion: it.correccion || null });
      res.sacrificios_nuevos++;
    }
    await conn.query("UPDATE animales SET estado = 'sacrificado' WHERE id = ?", [d.animal_id]);
    // El animal llegó a la planta: su transporte de la guía queda recibido.
    if (d.guia_id) {
      await conn.query(
        "UPDATE transporte SET estado = 'recibido', fecha_llegada = COALESCE(fecha_llegada, ?) WHERE guia_id = ? AND animal_id = ? AND estado <> 'cancelado'",
        [`${d.fecha} 00:00:00`, d.guia_id, d.animal_id]);
    }
  }
  const guias = [...new Set(plan.filas.filter(f => f.accion !== 'error' && f.datos.guia_id).map(f => f.datos.guia_id))];
  if (guias.length) await conn.query(`UPDATE guias_transporte SET estado = 'recibida' WHERE id IN (${marcas(guias.length)}) AND estado IN ('borrador','despachada')`, guias);
  return { resumen: res, reporte_planta: plan.reporte_planta };
}

module.exports = { planificar, aplicar, MERMA_MAX };
