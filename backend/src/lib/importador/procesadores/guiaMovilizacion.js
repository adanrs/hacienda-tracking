// Procesador de la guía de movilización del MAG/SENASA (FTZ-02): finca → planta.
//
// Cada documento (PDF con texto, .docx, foto leída o texto pegado) es UNA guía. La vista previa
// muestra la guía y una fila por bovino con su DIIO y el animal al que se liga. Por qué así:
//   - El DIIO es el mismo chip que la I.E. de Ganadero SG, escrito distinto (ver claveChip). Se liga
//     solo si UN animal tiene esa I.E.; si ninguno o varios, la fila queda «sin animal» con el aviso
//     y se corrige a mano en la pantalla de la guía. Nunca se adivina por arete, fecha o raza.
//   - Un ligue hecho a mano (vinculo = 'manual') no lo pisa una re-importación.
//   - Re-importar la misma guía no duplica: la llave es el número de guía. Si el texto cambió (una
//     foto leída de nuevo, más nítida) se actualiza: encabezado, filas y los DIIO que ya no vienen.
//   - Si los animales ligados salieron en una guía de transporte de la app el MISMO día, esa guía y
//     su transporte reciben el número oficial cuando todavía no lo tienen (campo guia_movilizacion).

const { marcas, fmtFechaSql, fechaTexto, documentosDelTexto } = require('../comun');
const { parsearGuiaMovilizacion, claveChip, serieChip, SEXO_TEXTO } = require('../guiaMovilizacionTexto');

const DOCUMENTO_PEGADO = 'Texto pegado'; // mismo nombre que usa foto.js para marcar lo leído por foto
const INICIO_GUIA = /SERVICIO NACIONAL DE SALUD ANIMAL/i;

const CAMPOS = [
  ['fecha', 'Fecha'], ['hora', 'Hora'], ['autorizacion', 'Autorización'],
  ['origen_nombre', 'Origen'], ['origen_establecimiento', 'Establecimiento de origen'], ['origen_cue', 'CUE de origen'],
  ['destino_nombre', 'Destino'], ['destino_establecimiento', 'Establecimiento de destino'], ['destino_cue', 'CUE de destino'],
  ['transportista', 'Transportista'], ['placa', 'Placa'], ['conductor', 'Conductor'], ['total_declarado', 'Bovinos declarados'],
];

const corta = (v, n) => (v == null || v === '' ? null : String(v).slice(0, n));

function encabezado(g) {
  return {
    numero: g.numero, fecha: g.fecha, hora: g.hora, autorizacion: corta(g.autorizacion, 30),
    origen_nombre: corta(g.origen.nombre, 200), origen_establecimiento: corta(g.origen.establecimiento, 200), origen_cue: corta(g.origen.cue, 20),
    destino_nombre: corta(g.destino.nombre, 200), destino_establecimiento: corta(g.destino.establecimiento, 200), destino_cue: corta(g.destino.cue, 20),
    transportista: corta(g.transportista, 200), placa: corta(g.placa, 40), conductor: corta(g.conductor, 200), total_declarado: g.total_bovinos,
  };
}

/** Animales cuya I.E. termina en la serie de alguno de los DIIO (LIKE '%serie', luego se compara la clave exacta). */
async function animalesPorChip(conn, diios) {
  const series = [...new Set(diios.map(serieChip).filter(Boolean))];
  const encontrados = [];
  for (let i = 0; i < series.length; i += 100) {
    const parte = series.slice(i, i + 100);
    const [rows] = await conn.query(
      `SELECT id, numero_trazabilidad, identificacion_electronica, sexo, estado FROM animales
       WHERE ${parte.map(() => 'identificacion_electronica LIKE ?').join(' OR ')}`, parte.map((s) => `%${s}`));
    encontrados.push(...rows);
  }
  const porClave = new Map();
  for (const a of encontrados) {
    const k = claveChip(a.identificacion_electronica);
    if (!k) continue;
    if (!porClave.has(k)) porClave.set(k, []);
    if (!porClave.get(k).some((x) => x.id === a.id)) porClave.get(k).push(a);
  }
  return porClave;
}

async function planificar(conn, _tabla, _opciones, { lectura }) {
  const filas = [];
  const guias = [];
  const leidas = [];
  for (const doc of lectura.documentos) {
    const nombre = doc.pegado ? DOCUMENTO_PEGADO : doc.nombre;
    if (doc.requiereVision) {
      filas.push({ fila: 1, documento: nombre, entidad: 'guia_movilizacion', clave: nombre, accion: 'error', errores: ['El PDF no trae texto (es una imagen escaneada): use «Cargar por foto»'], avisos: [] });
      continue;
    }
    // Un texto puede traer varias guías (varias fotos leídas seguidas, un PDF con varias): cada una
    // empieza en el membrete del SENASA; la página 2 de la misma guía se une por el número.
    const partes = documentosDelTexto(doc.texto, INICIO_GUIA, parsearGuiaMovilizacion, (g) => g.numero);
    partes.forEach((g, i) => leidas.push({ doc, nombre, seg: `${nombre}#${leidas.length}`, g, parte: partes.length > 1 ? i + 1 : null }));
  }

  const numeros = [...new Set(leidas.map((l) => l.g.numero).filter(Boolean))];
  let existentes = [];
  let lineasPrevias = [];
  if (numeros.length) {
    [existentes] = await conn.query(
      `SELECT id, numero, ${fmtFechaSql('fecha', 'fecha')}, hora, autorizacion, origen_nombre, origen_establecimiento, origen_cue,
              destino_nombre, destino_establecimiento, destino_cue, transportista, placa, conductor, total_declarado
       FROM guias_movilizacion WHERE numero IN (${marcas(numeros.length)})`, numeros);
    if (existentes.length) {
      [lineasPrevias] = await conn.query(
        `SELECT l.guia_id, l.diio, l.orden, l.sexo, l.raza, l.animal_id, l.vinculo, a.numero_trazabilidad
         FROM guia_movilizacion_animales l LEFT JOIN animales a ON a.id = l.animal_id
         WHERE l.guia_id IN (${marcas(existentes.length)})`, existentes.map((e) => e.id));
    }
  }
  const porNumero = new Map(existentes.map((e) => [e.numero, e]));
  const porClave = await animalesPorChip(conn, leidas.flatMap((l) => l.g.animales.map((a) => a.diio)));

  // Guías de transporte de la app del mismo día, por animal (para pasarles el número oficial).
  const fechas = [...new Set(leidas.map((l) => l.g.fecha).filter(Boolean))];
  let enTransporte = [];
  if (fechas.length) {
    [enTransporte] = await conn.query(
      `SELECT gt.id, gt.numero, gt.guia_movilizacion, ${fmtFechaSql('gt.fecha_salida', 'fecha')}, gta.animal_id, gta.transporte_id
       FROM guias_transporte gt JOIN guia_transporte_animales gta ON gta.guia_id = gt.id
       WHERE gt.fecha_salida IN (${marcas(fechas.length)})`, fechas);
  }

  const vistas = new Map();
  for (const { doc, nombre, seg, g } of leidas) {
    const errores = [];
    if (!g.numero) errores.push('No se encontró el número de la guía (No. EH…): revise el texto');
    if (!g.fecha) errores.push('No se encontró la fecha de la guía');
    if (!g.animales.length) errores.push('No se encontró ningún bovino con su DIIO en la guía');
    if (g.numero && vistas.has(g.numero)) errores.push(`La guía ${g.numero} viene dos veces en esta tanda (también en «${vistas.get(g.numero)}»)`);
    if (g.numero) vistas.set(g.numero, nombre);

    const datos = encabezado(g);
    const previa = g.numero ? porNumero.get(g.numero) : null;
    const guia = {
      clave: g.numero || nombre, documento: nombre, seg, ...datos, archivo_nombre: doc.pegado ? null : corta(doc.nombre, 255),
      guia_id: previa ? previa.id : null, accion: previa ? 'sin_cambios' : 'nuevo', cambios: [], avisos: [...g.avisos], errores,
      quitar: [], guias_transporte: [], animales: g.animales.length,
    };
    if (previa) {
      for (const [campo, etiqueta] of CAMPOS) {
        const antes = previa[campo] == null ? null : String(previa[campo]);
        const despues = datos[campo] == null ? null : String(datos[campo]);
        if (antes !== despues) guia.cambios.push({ campo, etiqueta, antes: previa[campo], despues: datos[campo] });
      }
    }
    const previasGuia = previa ? lineasPrevias.filter((l) => l.guia_id === previa.id) : [];
    const previaPorDiio = new Map(previasGuia.map((l) => [l.diio, l]));

    const diiosVistos = new Map();
    const ligados = [];
    for (const a of g.animales) {
      const f = {
        fila: a.orden, documento: nombre, seg, entidad: 'guia_movilizacion_animal', clave: a.diio, guia: g.numero,
        diio: a.diio, orden: a.orden, sexo: a.sexo, raza: a.raza, animal_id: null, arete: null, vinculo: null,
        accion: guia.accion === 'nuevo' ? 'nuevo' : 'sin_cambios', cambios: [], errores: [...errores], avisos: [],
      };
      if (diiosVistos.has(a.diio)) f.errores.push(`DIIO ${a.diio} repetido en la guía (también en la fila ${diiosVistos.get(a.diio)})`);
      diiosVistos.set(a.diio, a.orden);
      if (!a.sexo) f.avisos.push('No se leyó el sexo');

      const anterior = previaPorDiio.get(a.diio);
      const candidatos = porClave.get(claveChip(a.diio)) || [];
      if (anterior && anterior.vinculo === 'manual') {
        f.animal_id = anterior.animal_id; f.arete = anterior.numero_trazabilidad; f.vinculo = 'manual';
        f.avisos.push(`Ligado a mano a ${anterior.numero_trazabilidad || 'otro animal'}: se respeta`);
      } else if (candidatos.length === 1) {
        f.animal_id = candidatos[0].id; f.arete = candidatos[0].numero_trazabilidad; f.vinculo = 'automatico';
        const sexoAnimal = candidatos[0].sexo;
        if (a.sexo && sexoAnimal && ((a.sexo === 'H') !== (sexoAnimal === 'hembra'))) {
          f.avisos.push(`La guía dice ${SEXO_TEXTO[a.sexo]} y ${candidatos[0].numero_trazabilidad} está registrado como ${sexoAnimal}: revise`);
        }
      } else if (candidatos.length > 1) {
        f.avisos.push(`Sin animal: ${candidatos.length} animales tienen esta I.E. (${candidatos.map((c) => c.numero_trazabilidad).join(', ')}); lígelo a mano`);
      } else {
        f.avisos.push('Sin animal: ningún animal tiene esta I.E. Queda guardado para ligarlo a mano en la guía');
      }
      if (f.animal_id) ligados.push(f.animal_id);

      if (anterior) {
        const comparar = [['orden', 'Orden', anterior.orden, a.orden], ['sexo', 'Sexo', anterior.sexo, a.sexo], ['raza', 'Raza', anterior.raza, a.raza],
          ['animal_id', 'Animal', anterior.numero_trazabilidad, f.arete]];
        for (const [campo, etiqueta, antes, despues] of comparar) {
          if (String(antes ?? '') !== String(despues ?? '')) f.cambios.push({ campo, etiqueta, antes, despues });
        }
        f.accion = f.cambios.length ? 'actualizar' : 'sin_cambios';
      } else if (previa) {
        f.accion = 'nuevo';
      }
      if (f.errores.length) f.accion = 'error';
      filas.push(f);
    }

    guia.quitar = previasGuia.filter((l) => !g.animales.some((a) => a.diio === l.diio)).map((l) => l.diio);
    if (guia.quitar.length) guia.avisos.push(`Se quitan de la guía ${guia.quitar.length} DIIO que ya no vienen: ${guia.quitar.join(', ')}`);
    const filasGuia = filas.filter((f) => f.seg === seg && f.entidad === 'guia_movilizacion_animal');
    if (previa && (guia.cambios.length || guia.quitar.length || filasGuia.some((f) => f.accion === 'nuevo' || f.accion === 'actualizar'))) guia.accion = 'actualizar';
    if (errores.length) {
      guia.accion = 'error';
      if (!g.animales.length) filas.push({ fila: 1, documento: nombre, entidad: 'guia_movilizacion', clave: g.numero || nombre, accion: 'error', errores, avisos: [] });
    }

    // Guías de transporte de la app del mismo día con estos animales.
    const gts = new Map();
    for (const t of enTransporte) {
      if (t.fecha !== g.fecha || !ligados.includes(t.animal_id)) continue;
      if (!gts.has(t.id)) gts.set(t.id, { id: t.id, numero: t.numero, guia_movilizacion: t.guia_movilizacion, animales: 0, transportes: [] });
      const x = gts.get(t.id);
      x.animales++;
      if (t.transporte_id) x.transportes.push(t.transporte_id);
    }
    guia.guias_transporte = [...gts.values()];
    for (const t of guia.guias_transporte) {
      if (t.guia_movilizacion && t.guia_movilizacion !== g.numero) {
        guia.avisos.push(`La guía de transporte ${t.numero} ya tiene otra guía oficial (${t.guia_movilizacion}): no se cambia`);
      }
    }
    if (g.fecha && ligados.length && !guia.guias_transporte.length) {
      guia.avisos.push(`Ningún animal ligado salió en una guía de transporte de la app el ${fechaTexto(g.fecha)}`);
    }
    guia.ligados = ligados.length;
    guias.push(guia);
  }

  if (!filas.length) filas.push({ fila: 1, documento: null, entidad: 'guia_movilizacion', clave: '', accion: 'error', errores: ['No se pudo leer ninguna guía'], avisos: [] });
  const sinAnimal = filas.filter((f) => f.entidad === 'guia_movilizacion_animal' && f.accion !== 'error' && !f.animal_id).length;
  return { filas, guias, errores_generales: [], resumen: { guias: guias.filter((x) => x.accion !== 'error').length, sin_animal: sinAnimal } };
}

async function aplicar(conn, plan, { importacionId, usuarioId, registrar }) {
  const res = { guias_nuevas: 0, guias_actualizadas: 0, animales_ligados: 0, sin_animal: 0, guias_transporte: 0, guias: [] };
  for (const g of plan.guias) {
    if (g.accion === 'error') continue;
    const filas = plan.filas.filter((f) => f.entidad === 'guia_movilizacion_animal' && f.seg === g.seg && f.accion !== 'error');
    let guiaId = g.guia_id;
    const valores = [g.fecha, g.hora, g.autorizacion, g.origen_nombre, g.origen_establecimiento, g.origen_cue, g.destino_nombre,
      g.destino_establecimiento, g.destino_cue, g.transportista, g.placa, g.conductor, g.total_declarado];
    if (!guiaId) {
      const [r] = await conn.query(
        `INSERT INTO guias_movilizacion (numero, fecha, hora, autorizacion, origen_nombre, origen_establecimiento, origen_cue,
           destino_nombre, destino_establecimiento, destino_cue, transportista, placa, conductor, total_declarado,
           archivo_nombre, importacion_id, creado_por)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [g.numero, ...valores, g.archivo_nombre, importacionId, usuarioId || null]);
      guiaId = r.insertId;
      res.guias_nuevas++;
      registrar(null, 'guia_movilizacion', guiaId, 'creado', { numero: g.numero, animales: filas.length });
    } else if (g.accion === 'actualizar') {
      await conn.query(
        `UPDATE guias_movilizacion SET fecha = ?, hora = ?, autorizacion = ?, origen_nombre = ?, origen_establecimiento = ?, origen_cue = ?,
           destino_nombre = ?, destino_establecimiento = ?, destino_cue = ?, transportista = ?, placa = ?, conductor = ?, total_declarado = ?,
           archivo_nombre = COALESCE(?, archivo_nombre), importacion_id = ?
         WHERE id = ?`, [...valores, g.archivo_nombre, importacionId, guiaId]);
      res.guias_actualizadas++;
      registrar(null, 'guia_movilizacion', guiaId, 'actualizado', { numero: g.numero, cambios: g.cambios, quitados: g.quitar });
    } else {
      registrar(null, 'guia_movilizacion', guiaId, 'sin_cambios', { numero: g.numero });
    }
    if (g.quitar.length) {
      await conn.query(`DELETE FROM guia_movilizacion_animales WHERE guia_id = ? AND diio IN (${marcas(g.quitar.length)})`, [guiaId, ...g.quitar]);
    }
    for (const f of filas) {
      // Un ligue manual no se pisa: la base lo vuelve a revisar aunque la vista previa ya lo respetó.
      await conn.query(
        `INSERT INTO guia_movilizacion_animales (guia_id, orden, diio, sexo, raza, animal_id, vinculo)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE orden = VALUES(orden), sexo = VALUES(sexo), raza = VALUES(raza),
           animal_id = IF(vinculo = 'manual', animal_id, VALUES(animal_id)),
           vinculo = IF(vinculo = 'manual', vinculo, VALUES(vinculo))`,
        [guiaId, f.orden, f.diio, f.sexo, f.raza, f.animal_id, f.animal_id ? f.vinculo : null]);
      if (f.animal_id) res.animales_ligados++; else res.sin_animal++;
      if (f.accion !== 'sin_cambios') registrar(f.fila, 'guia_movilizacion_animal', f.animal_id, f.accion === 'nuevo' ? 'creado' : 'actualizado', { guia: g.numero, diio: f.diio, arete: f.arete });
    }
    // Número oficial a la guía de transporte de la app y a su transporte, solo donde falta.
    for (const t of g.guias_transporte) {
      const [u] = await conn.query("UPDATE guias_transporte SET guia_movilizacion = ? WHERE id = ? AND (guia_movilizacion IS NULL OR guia_movilizacion = '')", [g.numero, t.id]);
      if (u.affectedRows) { res.guias_transporte++; registrar(null, 'guia', t.id, 'actualizado', { guia_movilizacion: g.numero }); }
      if (t.transportes.length) {
        await conn.query(`UPDATE transporte SET guia_movilizacion = ? WHERE id IN (${marcas(t.transportes.length)}) AND (guia_movilizacion IS NULL OR guia_movilizacion = '')`, [g.numero, ...t.transportes]);
      }
    }
    if (g.guias_transporte.length === 1) {
      await conn.query('UPDATE guias_movilizacion SET guia_transporte_id = ? WHERE id = ?', [g.guias_transporte[0].id, guiaId]);
    }
    res.guias.push({ id: guiaId, numero: g.numero });
  }
  return { resumen: res, guias: res.guias };
}

module.exports = { planificar, aplicar };
