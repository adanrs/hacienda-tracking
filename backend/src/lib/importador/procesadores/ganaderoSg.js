// Procesador del reporte «Software GANADERO SG – Reportes Personalizados» (salida de animales).
//
// El reporte es la base de la GUÍA DE TRANSPORTE finca → planta. De cada fila sale:
//   - la ficha del animal (alta o actualización; nunca se borra un dato que ya exista),
//   - pesajes: «venta» con el Peso sal. en la Fec. salida; «rutinario» con el U.Peso cuando no
//     coincide con el de salida (con la fecha «Actualizado a» del reporte, que es la única que trae),
//   - la última vacuna (FUV + UV) como evento de salud,
//   - el potrero (se crea si no existe, por nombre),
//   - y, si trae Fec. salida, la línea de la guía del día (fecha + finca + «Vendido a») con la
//     ficha congelada al momento de salir y su fila de `transporte` (tipo matadero).
//
// Llave del animal: la I.E. (chip) si viene; si no, el Número (arete). Normalizados.
// Clave natural de lo demás (para no duplicar al re-importar): pesaje = animal + fecha + tipo;
// vacuna = animal + fecha + producto; guía = fecha + finca + comprador; línea = guía + animal.

const { marcas, num, iguales, fmtFechaSql, fechaTexto } = require('../comun');
const { normalizarArete, normalizarEncabezado } = require('../texto');
const { numeroDiario } = require('../../consecutivos');

// Códigos de raza de Ganadero SG que se reconocen (WAG/50-BRA/37-CEB/12). Otro código no
// bloquea: queda como aviso para confirmarlo con el dueño y agregarlo aquí.
const RAZAS = {
  WAG: 'Wagyu', BRA: 'Brahman', CEB: 'Cebú', ANG: 'Angus', BRG: 'Brangus', NEL: 'Nelore',
  GYR: 'Gyr', SIM: 'Simmental', CHA: 'Charolais', HER: 'Hereford', HOL: 'Holstein', JER: 'Jersey',
  SGE: 'Santa Gertrudis', SEN: 'Senepol', BEE: 'Beefmaster', IND: 'Indubrasil', RMS: 'Romosinuano',
};

const RANGO_PESO = [30, 1500]; // kg; fuera de esto es un error de digitación, no un animal
const ETIQUETAS = {
  numero_trazabilidad: 'Número', identificacion_electronica: 'I.E.', sexo: 'Sexo', raza: 'Raza',
  fecha_nacimiento: 'F. nacimiento', madre_numero: '# Madre', padre_numero: '# Padre',
  madre_id: 'Madre (en la app)', padre_id: 'Padre (en la app)', potrero_id: 'Potrero', finca: 'Finca',
  peso_actual: 'Peso actual',
};

function revisarRaza(raza) {
  const avisos = [];
  const partes = String(raza).toUpperCase().split(/[-+]/).map(p => p.trim()).filter(Boolean);
  let suma = 0;
  let conPorcentaje = 0;
  for (const p of partes) {
    const m = p.match(/^([A-Z]+)\s*\/?\s*(\d+(?:[.,]\d+)?)?$/);
    if (!m) { avisos.push(`raza «${raza}»: no se entiende «${p}»`); continue; }
    if (!RAZAS[m[1]]) avisos.push(`raza desconocida «${m[1]}» (en «${raza}»): confirme el código`);
    if (m[2]) { suma += Number(m[2].replace(',', '.')); conPorcentaje++; }
  }
  // 50+37+12 = 99: Ganadero SG redondea cada parte, así que se tolera ±2.
  if (conPorcentaje > 1 && Math.abs(suma - 100) > 2) avisos.push(`raza «${raza}»: los porcentajes suman ${suma}, no 100`);
  return avisos;
}

const hoyIso = () => new Date().toISOString().slice(0, 10);

/** Validaciones de una fila que no dependen de la base. */
function validarFila(v, errores, avisos) {
  if (!v.numero) errores.push('Número (arete) vacío');
  for (const [campo, nombre] of [['ultimo_peso', 'U.Peso'], ['peso_salida', 'Peso sal.']]) {
    if (v[campo] != null && (v[campo] < RANGO_PESO[0] || v[campo] > RANGO_PESO[1])) {
      errores.push(`${nombre} ${v[campo]} kg fuera de rango (${RANGO_PESO[0]}–${RANGO_PESO[1]} kg)`);
    }
  }
  const hoy = hoyIso();
  if (v.fecha_nacimiento && (v.fecha_nacimiento > hoy || v.fecha_nacimiento < '1990-01-01')) errores.push(`F. Nto ${fechaTexto(v.fecha_nacimiento)} no es posible`);
  if (v.fecha_salida && v.fecha_nacimiento && v.fecha_salida < v.fecha_nacimiento) errores.push('Fec. salida es anterior al nacimiento');
  if (v.fecha_ultima_vacuna && v.fecha_nacimiento && v.fecha_ultima_vacuna < v.fecha_nacimiento) avisos.push('FUV es anterior al nacimiento');
  if (v.edad_meses != null && (v.edad_meses < 0 || v.edad_meses > 240)) avisos.push(`E.Mes ${v.edad_meses} fuera de lo normal`);
  if (v.gr_dia_vida != null && (v.gr_dia_vida < 0 || v.gr_dia_vida > 3000)) avisos.push(`gr/día/vida ${v.gr_dia_vida} fuera de lo normal`);
  if (v.ie && v.ie.length < 15) avisos.push(`I.E. «${v.ie}» más corta de lo normal (${v.ie.length} caracteres)`);
  if (v.raza) avisos.push(...revisarRaza(v.raza));
  if (v.fecha_salida && v.peso_salida == null) avisos.push('Trae Fec. salida pero no Peso sal.');
}

async function cargarAnimales(conn, numeros, ies) {
  if (!numeros.length && !ies.length) return [];
  const cond = [];
  const params = [];
  if (numeros.length) { cond.push(`UPPER(TRIM(numero_trazabilidad)) IN (${marcas(numeros.length)})`); params.push(...numeros); }
  if (ies.length) { cond.push(`identificacion_electronica IN (${marcas(ies.length)})`); params.push(...ies); }
  const [rows] = await conn.query(
    `SELECT id, numero_trazabilidad, identificacion_electronica, sexo, raza, ${fmtFechaSql('fecha_nacimiento', 'fecha_nacimiento')},
            peso_actual, madre_id, padre_id, madre_numero, padre_numero, potrero_id, finca, estado
     FROM animales WHERE ${cond.join(' OR ')}`, params);
  return rows.map(r => ({ ...r, peso_actual: num(r.peso_actual), numero_norm: normalizarArete(r.numero_trazabilidad) }));
}

async function planificar(conn, tabla, opciones = {}) {
  const crearGuias = opciones.crear_guias !== false;
  const meta = tabla.metadatos || {};
  const finca = meta.finca ? meta.finca.replace(/\s+/g, ' ').trim() : '';

  // 1. Validación de cada fila y duplicados dentro del archivo.
  const filas = tabla.filas.map(f => ({ fila: f.fila, v: f.valores, errores: [...f.errores], avisos: [] }));
  const vistosNumero = new Map();
  const vistosIE = new Map();
  for (const f of filas) {
    validarFila(f.v, f.errores, f.avisos);
    if (f.v.numero) {
      if (vistosNumero.has(f.v.numero)) f.errores.push(`Número repetido en el archivo (también en la fila ${vistosNumero.get(f.v.numero)})`);
      else vistosNumero.set(f.v.numero, f.fila);
    }
    if (f.v.ie) {
      if (vistosIE.has(f.v.ie)) f.errores.push(`I.E. repetida en el archivo (también en la fila ${vistosIE.get(f.v.ie)})`);
      else vistosIE.set(f.v.ie, f.fila);
    }
  }

  // 2. Lo que ya existe en la base, en pocas consultas.
  const numeros = [...vistosNumero.keys()];
  const ies = [...vistosIE.keys()];
  const existentes = await cargarAnimales(conn, numeros, ies);
  const porNumero = new Map(existentes.map(a => [a.numero_norm, a]));
  const porIE = new Map(existentes.filter(a => a.identificacion_electronica).map(a => [a.identificacion_electronica, a]));

  const padres = [...new Set(filas.flatMap(f => [f.v.madre, f.v.padre]).filter(Boolean))];
  const padresExistentes = padres.length ? await cargarAnimales(conn, padres, []) : [];
  const idPadre = new Map(padresExistentes.map(a => [a.numero_norm, a.id]));

  const [potreros] = await conn.query('SELECT id, nombre FROM potreros');
  const potreroPorNombre = new Map(potreros.map(p => [normalizarEncabezado(p.nombre), p]));
  const potrerosNuevos = new Map();

  const ids = existentes.map(a => a.id);
  let pesajes = [];
  let vacunas = [];
  let enGuias = [];
  if (ids.length) {
    [pesajes] = await conn.query(`SELECT id, animal_id, ${fmtFechaSql('fecha', 'fecha')}, tipo, peso_kg FROM pesajes WHERE animal_id IN (${marcas(ids.length)})`, ids);
    [vacunas] = await conn.query(`SELECT id, animal_id, ${fmtFechaSql('fecha', 'fecha')}, UPPER(TRIM(COALESCE(producto, descripcion))) AS producto FROM eventos_salud WHERE tipo = 'vacunacion' AND animal_id IN (${marcas(ids.length)})`, ids);
    [enGuias] = await conn.query(
      `SELECT gta.animal_id, gta.transporte_id, gta.guia_id, g.numero, ${fmtFechaSql('g.fecha_salida', 'fecha_salida')}, g.finca_origen, g.comprador
       FROM guia_transporte_animales gta JOIN guias_transporte g ON g.id = gta.guia_id
       WHERE g.estado <> 'anulada' AND gta.animal_id IN (${marcas(ids.length)})`, ids);
  }
  const pesajeDe = (id, fecha, tipo) => pesajes.find(p => p.animal_id === id && p.fecha === fecha && p.tipo === tipo);
  const vacunaDe = (id, fecha, producto) => vacunas.find(p => p.animal_id === id && p.fecha === fecha && p.producto === producto);

  const [plantas] = await conn.query('SELECT nombre, direccion_linea1 FROM config_planta WHERE activa = 1 ORDER BY id LIMIT 1');
  const destino = plantas.length ? [plantas[0].nombre, plantas[0].direccion_linea1].filter(Boolean).join(' · ') : null;

  // 3. Plan por fila.
  const salida = [];
  for (const f of filas) {
    const v = f.v;
    const item = { fila: f.fila, entidad: 'animal', clave: v.ie || v.numero || '', numero: v.numero, ie: v.ie, accion: 'nuevo', animal_id: null, cambios: [], errores: f.errores, avisos: f.avisos, acciones: [] };
    salida.push(item);

    // Resolver el animal: I.E. primero, número después; si apuntan a animales distintos es un conflicto.
    const porI = v.ie ? porIE.get(v.ie) : null;
    const porN = v.numero ? porNumero.get(v.numero) : null;
    let animal = porI || porN || null;
    if (porI && porN && porI.id !== porN.id) {
      item.errores.push(`La I.E. es del animal ${porI.numero_trazabilidad} pero el número ${v.numero} es de otro animal: revise el reporte`);
    } else if (!porI && porN && v.ie && porN.identificacion_electronica && porN.identificacion_electronica !== v.ie) {
      item.errores.push(`El número ${v.numero} ya existe con otra I.E. (${porN.identificacion_electronica})`);
      animal = null;
    }
    if (!animal && !v.sexo) item.errores.push('Sexo vacío: es obligatorio para un animal nuevo');

    // Datos de la ficha que trae el reporte (solo lo que viene; nunca se borra lo que ya hay).
    const nuevoPotrero = (() => {
      if (!v.potrero) return null;
      const n = normalizarEncabezado(v.potrero);
      const p = potreroPorNombre.get(n);
      if (p) return { id: p.id, nombre: p.nombre };
      if (!potrerosNuevos.has(n)) potrerosNuevos.set(n, v.potrero.trim());
      return { id: null, nombre: potrerosNuevos.get(n), nuevo: true };
    })();
    const ficha = {
      numero_trazabilidad: v.numero,
      identificacion_electronica: v.ie,
      sexo: v.sexo,
      raza: v.raza,
      fecha_nacimiento: v.fecha_nacimiento,
      madre_numero: v.madre,
      padre_numero: v.padre,
      madre_id: v.madre ? idPadre.get(v.madre) || null : null,
      padre_id: v.padre ? idPadre.get(v.padre) || null : null,
      potrero_id: nuevoPotrero ? nuevoPotrero.id : null,
      finca: finca || null,
      peso_actual: v.peso_salida ?? v.ultimo_peso ?? null,
    };
    item.datos = { ...ficha, potrero_nombre: nuevoPotrero ? nuevoPotrero.nombre : null, potrero_nuevo: !!(nuevoPotrero && nuevoPotrero.nuevo) };
    // Si la madre/padre no está registrada en la app se guarda solo su número (madre_numero/padre_numero):
    // es lo normal en engorde (las madres están en otra finca), así que no se avisa.

    if (animal) {
      item.accion = 'sin_cambios';
      item.animal_id = animal.id;
      for (const [campo, despues] of Object.entries(ficha)) {
        if (despues == null) continue;
        if (campo === 'potrero_id' && nuevoPotrero && nuevoPotrero.nuevo) continue; // se informa abajo
        if (campo === 'numero_trazabilidad' && animal.numero_norm === despues) continue;
        if (!iguales(animal[campo], despues)) item.cambios.push({ campo, etiqueta: ETIQUETAS[campo], antes: animal[campo], despues });
      }
      if (nuevoPotrero && nuevoPotrero.nuevo) item.cambios.push({ campo: 'potrero_id', etiqueta: 'Potrero', antes: animal.potrero_id, despues: `${nuevoPotrero.nombre} (nuevo)` });
      if (item.cambios.some(c => c.campo === 'numero_trazabilidad')) item.avisos.push(`Cambia el número del animal: ${animal.numero_trazabilidad} → ${v.numero} (misma I.E.)`);
      if (item.cambios.some(c => c.campo === 'sexo')) item.avisos.push('Cambia el sexo registrado');
      if (animal.estado === 'sacrificado') item.avisos.push('El animal ya figura como sacrificado');
    }

    // Pesajes, vacuna y salida.
    const id = animal ? animal.id : null;
    if (v.fecha_salida && v.peso_salida != null) {
      const p = id && pesajeDe(id, v.fecha_salida, 'venta');
      item.acciones.push({ entidad: 'pesaje', tipo: 'venta', fecha: v.fecha_salida, peso_kg: v.peso_salida, accion: !p ? 'nuevo' : iguales(num(p.peso_kg), v.peso_salida) ? 'sin_cambios' : 'actualizar', id: p ? p.id : null, antes: p ? num(p.peso_kg) : null });
    }
    if (v.ultimo_peso != null && !(v.fecha_salida && iguales(v.ultimo_peso, v.peso_salida))) {
      if (meta.actualizado_a) {
        const p = id && pesajeDe(id, meta.actualizado_a, 'rutinario');
        item.acciones.push({ entidad: 'pesaje', tipo: 'rutinario', fecha: meta.actualizado_a, peso_kg: v.ultimo_peso, accion: !p ? 'nuevo' : iguales(num(p.peso_kg), v.ultimo_peso) ? 'sin_cambios' : 'actualizar', id: p ? p.id : null, antes: p ? num(p.peso_kg) : null });
        item.avisos.push(`U.Peso se registra con la fecha «Actualizado a» (${fechaTexto(meta.actualizado_a)}): el reporte no trae la fecha real del pesaje`);
      } else {
        item.avisos.push('U.Peso no se registra como pesaje: el reporte no trae fecha («Actualizado a»)');
      }
    }
    if (v.fecha_ultima_vacuna && v.ultima_vacuna) {
      const producto = v.ultima_vacuna.trim().toUpperCase();
      const e = id && vacunaDe(id, v.fecha_ultima_vacuna, producto);
      item.acciones.push({ entidad: 'vacuna', fecha: v.fecha_ultima_vacuna, producto, accion: e ? 'sin_cambios' : 'nuevo', id: e ? e.id : null });
    } else if (v.ultima_vacuna && !v.fecha_ultima_vacuna) {
      item.avisos.push('UV sin FUV: la vacuna no se registra');
    }

    if (crearGuias && v.fecha_salida) {
      const otra = id && enGuias.find(g => g.animal_id === id && !(g.fecha_salida === v.fecha_salida && g.finca_origen === (finca || '') && g.comprador === (v.vendido_a || '')));
      if (otra) item.errores.push(`Ya está en la guía ${otra.numero} del ${fechaTexto(otra.fecha_salida)}: anule esa guía o corrija la fecha de salida`);
      const ya = id && enGuias.find(g => g.animal_id === id && g.fecha_salida === v.fecha_salida && g.finca_origen === (finca || '') && g.comprador === (v.vendido_a || ''));
      item.salida = {
        fecha_salida: v.fecha_salida, comprador: v.vendido_a || '', peso_salida_kg: v.peso_salida,
        ya_en_guia: ya ? ya.numero : null, transporte_id: ya ? ya.transporte_id : null,
        linea: {
          arete: v.numero, identificacion_electronica: v.ie, sexo: v.sexo, raza: v.raza,
          fecha_nacimiento: v.fecha_nacimiento, edad_meses: v.edad_meses, madre_numero: v.madre,
          padre_numero: v.padre, potrero: v.potrero, dias_potrero: v.dias_potrero,
          ultimo_peso_kg: v.ultimo_peso, gr_dia_vida: v.gr_dia_vida,
          fecha_ultima_vacuna: v.fecha_ultima_vacuna, ultima_vacuna: v.ultima_vacuna,
          causa_salida: v.causa_salida, tipo_destino: v.tipo_destino, obs_salida: v.obs_salida,
          peso_salida_kg: v.peso_salida,
        },
      };
      if (!ya) item.acciones.push({ entidad: 'guia', accion: 'nuevo', fecha: v.fecha_salida });
    }

    if (item.errores.length) item.accion = 'error';
    else if (!animal) item.accion = 'nuevo';
    else if (item.cambios.length || item.acciones.some(a => a.accion !== 'sin_cambios')) item.accion = 'actualizar';
  }

  // 4. Guías: una por fecha de salida + finca + comprador, con las filas válidas.
  const guias = [];
  if (crearGuias) {
    const grupos = new Map();
    for (const it of salida) {
      if (!it.salida || it.accion === 'error') continue;
      const k = `${it.salida.fecha_salida}|${it.salida.comprador}`;
      if (!grupos.has(k)) grupos.set(k, { fecha_salida: it.salida.fecha_salida, comprador: it.salida.comprador, filas: [] });
      grupos.get(k).filas.push(it);
    }
    const fechas = [...new Set([...grupos.values()].map(g => g.fecha_salida))];
    let existentesG = [];
    if (fechas.length) {
      [existentesG] = await conn.query(
        `SELECT g.id, g.numero, ${fmtFechaSql('g.fecha_salida', 'fecha_salida')}, g.finca_origen, g.comprador, g.estado,
                (SELECT COUNT(*) FROM guia_transporte_animales x WHERE x.guia_id = g.id) AS animales
         FROM guias_transporte g WHERE g.fecha_salida IN (${marcas(fechas.length)})`, fechas);
    }
    for (const g of grupos.values()) {
      const ex = existentesG.find(e => e.fecha_salida === g.fecha_salida && e.finca_origen === (finca || '') && e.comprador === g.comprador);
      const tipos = g.filas.map(f => f.salida.linea.tipo_destino).filter(Boolean);
      const causas = g.filas.map(f => f.salida.linea.causa_salida).filter(Boolean);
      const nuevosEnGuia = g.filas.filter(f => !f.salida.ya_en_guia).length;
      const pesoTotal = g.filas.reduce((s, f) => s + (f.salida.peso_salida_kg || 0), 0);
      const guia = {
        clave: `${g.fecha_salida}|${finca}|${g.comprador}`,
        fecha_salida: g.fecha_salida, finca_origen: finca, comprador: g.comprador, destino,
        tipo_destino: tipos[0] || null, causa_salida: causas[0] || null,
        animales: g.filas.map(f => ({ fila: f.fila, arete: f.numero, peso_salida_kg: f.salida.peso_salida_kg })),
        total_animales: g.filas.length, peso_total_kg: Math.round(pesoTotal * 100) / 100,
        accion: ex ? (nuevosEnGuia || g.filas.some(f => f.accion !== 'sin_cambios') ? 'actualizar' : 'sin_cambios') : 'nuevo',
        guia_id: ex ? ex.id : null, numero: ex ? ex.numero : null,
        avisos: [],
      };
      if (ex && ex.estado === 'anulada') guia.avisos.push(`La guía ${ex.numero} de ese día está anulada: se reactivará como borrador`);
      if (ex && Number(ex.animales) > g.filas.length - nuevosEnGuia) guia.avisos.push(`La guía ${ex.numero} ya tiene ${ex.animales - (g.filas.length - nuevosEnGuia)} animal(es) que no vienen en este archivo: se conservan`);
      if (!finca) guia.avisos.push('El reporte no trae la finca (línea «01-003 - …»): la guía queda sin finca de origen');
      if (new Set(tipos).size > 1) guia.avisos.push(`Tipos de destino distintos en el mismo día: ${[...new Set(tipos)].join(', ')}`);
      guias.push(guia);
    }
  }

  return {
    filas: salida,
    guias,
    potreros_nuevos: [...potrerosNuevos.values()],
    resumen: { guias: guias.length, potreros_nuevos: potrerosNuevos.size },
  };
}

// Columnas de animales que este procesador puede escribir (lista fija: nunca un nombre del request).
const COLUMNAS_ANIMAL = new Set(Object.keys(ETIQUETAS));

async function aplicar(conn, plan, { importacionId, usuarioId, registrar }) {
  const res = { animales_nuevos: 0, animales_actualizados: 0, pesajes: 0, vacunas: 0, potreros: 0, guias: [] };

  // Potreros nuevos (por nombre normalizado, sin repetir).
  const idPotrero = new Map();
  for (const nombre of plan.potreros_nuevos) {
    const [r] = await conn.query("INSERT INTO potreros (nombre, estado, notas) VALUES (?, 'activo', ?)", [nombre, 'Creado por la importación de Ganadero SG']);
    idPotrero.set(normalizarEncabezado(nombre), r.insertId);
    registrar(null, 'potrero', r.insertId, 'creado', { nombre });
    res.potreros++;
  }

  const animalDeFila = new Map();
  for (const it of plan.filas) {
    if (it.accion === 'error') continue;
    const d = it.datos;
    const potreroId = d.potrero_nuevo ? idPotrero.get(normalizarEncabezado(d.potrero_nombre)) : d.potrero_id;
    let animalId = it.animal_id;
    if (!animalId) {
      const [r] = await conn.query(
        `INSERT INTO animales (numero_trazabilidad, tipo, raza, sexo, fecha_nacimiento, peso_actual, estado, madre_id, padre_id, potrero_id,
                               notas, identificacion_electronica, madre_numero, padre_numero, finca)
         VALUES (?, 'bovino', ?, ?, ?, ?, 'activo', ?, ?, ?, ?, ?, ?, ?, ?)`,
        [d.numero_trazabilidad, d.raza, d.sexo, d.fecha_nacimiento, d.peso_actual, d.madre_id, d.padre_id, potreroId || null,
          'Importado de Ganadero SG', d.identificacion_electronica, d.madre_numero, d.padre_numero, d.finca]);
      animalId = r.insertId;
      registrar(it.fila, 'animal', animalId, 'creado', { numero: d.numero_trazabilidad, ie: d.identificacion_electronica });
      res.animales_nuevos++;
    } else if (it.cambios.length) {
      const sets = [];
      const params = [];
      for (const c of it.cambios) {
        if (!COLUMNAS_ANIMAL.has(c.campo)) continue;
        sets.push(`\`${c.campo}\` = ?`);
        params.push(c.campo === 'potrero_id' ? potreroId : d[c.campo]);
      }
      if (sets.length) {
        await conn.query(`UPDATE animales SET ${sets.join(', ')} WHERE id = ?`, [...params, animalId]);
        registrar(it.fila, 'animal', animalId, 'actualizado', { cambios: it.cambios });
        res.animales_actualizados++;
      }
    } else {
      registrar(it.fila, 'animal', animalId, 'sin_cambios', null);
    }
    animalDeFila.set(it.fila, animalId);

    for (const a of it.acciones) {
      if (a.entidad === 'pesaje') {
        if (a.accion === 'nuevo') {
          const [r] = await conn.query('INSERT INTO pesajes (animal_id, peso_kg, fecha, tipo, notas) VALUES (?, ?, ?, ?, ?)',
            [animalId, a.peso_kg, a.fecha, a.tipo, a.tipo === 'venta' ? 'Peso de salida (Ganadero SG)' : 'U.Peso del reporte Ganadero SG']);
          registrar(it.fila, 'pesaje', r.insertId, 'creado', { tipo: a.tipo, fecha: a.fecha, peso_kg: a.peso_kg });
          res.pesajes++;
        } else if (a.accion === 'actualizar') {
          await conn.query('UPDATE pesajes SET peso_kg = ? WHERE id = ?', [a.peso_kg, a.id]);
          registrar(it.fila, 'pesaje', a.id, 'actualizado', { antes: a.antes, despues: a.peso_kg });
          res.pesajes++;
        }
      } else if (a.entidad === 'vacuna' && a.accion === 'nuevo') {
        const [r] = await conn.query(
          "INSERT INTO eventos_salud (animal_id, tipo, fecha, descripcion, producto, notas) VALUES (?, 'vacunacion', ?, ?, ?, ?)",
          [animalId, a.fecha, `Vacuna ${a.producto}`, a.producto, 'Última vacuna según Ganadero SG']);
        registrar(it.fila, 'vacuna', r.insertId, 'creado', { fecha: a.fecha, producto: a.producto });
        res.vacunas++;
      }
    }
  }

  // Guías del día con sus líneas y la fila de transporte de cada animal.
  for (const g of plan.guias) {
    let guiaId = g.guia_id;
    let numero = g.numero;
    if (!guiaId) {
      numero = await numeroDiario(conn, { prefijo: 'GT', tabla: 'guias_transporte', fecha: new Date(`${g.fecha_salida}T18:00:00Z`) });
      const [r] = await conn.query(
        `INSERT INTO guias_transporte (numero, fecha_salida, finca_origen, destino, comprador, tipo_destino, causa_salida, estado, importacion_id, creado_por)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'borrador', ?, ?)`,
        [numero, g.fecha_salida, g.finca_origen || '', g.destino, g.comprador || '', g.tipo_destino, g.causa_salida, importacionId, usuarioId || null]);
      guiaId = r.insertId;
      registrar(null, 'guia', guiaId, 'creado', { numero, fecha_salida: g.fecha_salida, comprador: g.comprador });
    } else {
      await conn.query(
        "UPDATE guias_transporte SET tipo_destino = COALESCE(?, tipo_destino), causa_salida = COALESCE(?, causa_salida), destino = COALESCE(destino, ?), importacion_id = ?, estado = IF(estado = 'anulada', 'borrador', estado) WHERE id = ?",
        [g.tipo_destino, g.causa_salida, g.destino, importacionId, guiaId]);
      registrar(null, 'guia', guiaId, 'actualizado', { numero });
    }

    let orden = 0;
    for (const a of g.animales) {
      orden++;
      const it = plan.filas.find(f => f.fila === a.fila);
      const animalId = animalDeFila.get(a.fila);
      const s = it.salida;
      const l = s.linea;
      let transporteId = s.transporte_id;
      if (transporteId) {
        await conn.query('UPDATE transporte SET fecha_salida = ?, peso_pie_finca = ?, guia_movilizacion = COALESCE(guia_movilizacion, ?), guia_id = ? WHERE id = ?',
          [`${s.fecha_salida} 00:00:00`, s.peso_salida_kg, numero, guiaId, transporteId]);
      } else {
        const [r] = await conn.query(
          `INSERT INTO transporte (animal_id, tipo, destino, fecha_salida, guia_movilizacion, estado, notas, peso_pie_finca, guia_id)
           VALUES (?, 'matadero', ?, ?, ?, 'programado', ?, ?, ?)`,
          [animalId, g.destino, `${s.fecha_salida} 00:00:00`, numero, `Guía ${numero} (Ganadero SG)`, s.peso_salida_kg, guiaId]);
        transporteId = r.insertId;
        registrar(it.fila, 'transporte', transporteId, 'creado', { guia: numero });
      }
      await conn.query(
        `INSERT INTO guia_transporte_animales
           (guia_id, animal_id, transporte_id, orden, arete, identificacion_electronica, sexo, raza, fecha_nacimiento, edad_meses,
            madre_numero, padre_numero, potrero, dias_potrero, ultimo_peso_kg, gr_dia_vida, fecha_ultima_vacuna, ultima_vacuna,
            causa_salida, tipo_destino, obs_salida, peso_salida_kg, fila_origen)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE transporte_id = VALUES(transporte_id), arete = VALUES(arete),
           identificacion_electronica = VALUES(identificacion_electronica), sexo = VALUES(sexo), raza = VALUES(raza),
           fecha_nacimiento = VALUES(fecha_nacimiento), edad_meses = VALUES(edad_meses), madre_numero = VALUES(madre_numero),
           padre_numero = VALUES(padre_numero), potrero = VALUES(potrero), dias_potrero = VALUES(dias_potrero),
           ultimo_peso_kg = VALUES(ultimo_peso_kg), gr_dia_vida = VALUES(gr_dia_vida), fecha_ultima_vacuna = VALUES(fecha_ultima_vacuna),
           ultima_vacuna = VALUES(ultima_vacuna), causa_salida = VALUES(causa_salida), tipo_destino = VALUES(tipo_destino),
           obs_salida = VALUES(obs_salida), peso_salida_kg = VALUES(peso_salida_kg), fila_origen = VALUES(fila_origen)`,
        [guiaId, animalId, transporteId, orden, l.arete, l.identificacion_electronica, l.sexo, l.raza, l.fecha_nacimiento, l.edad_meses,
          l.madre_numero, l.padre_numero, l.potrero, l.dias_potrero, l.ultimo_peso_kg, l.gr_dia_vida, l.fecha_ultima_vacuna,
          l.ultima_vacuna, l.causa_salida, l.tipo_destino, l.obs_salida, l.peso_salida_kg, it.fila]);
    }
    // Totales desde las líneas (incluye animales que la guía ya tenía y no venían en este archivo).
    await conn.query(
      `UPDATE guias_transporte g SET
         total_animales = (SELECT COUNT(*) FROM guia_transporte_animales x WHERE x.guia_id = g.id),
         peso_total_kg = (SELECT SUM(peso_salida_kg) FROM guia_transporte_animales x WHERE x.guia_id = g.id)
       WHERE g.id = ?`, [guiaId]);
    res.guias.push({ id: guiaId, numero });
  }
  return { resumen: { ...res, guias: res.guias.length }, guias: res.guias };
}

module.exports = { planificar, aplicar, revisarRaza, RAZAS };
