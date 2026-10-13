// Armado seguro de UPDATE/INSERT a partir del body de una petición.
//
// Por qué existe: varias rutas hacían `UPDATE tabla SET ${claves del body}`. Las CLAVES
// del JSON no pasan por los placeholders `?`, así que cualquier usuario autenticado podía
// inyectar SQL en el nombre del campo (p. ej. `{"estado='abierto' WHERE 1=1 -- ": 1}`)
// o escribir columnas que el formulario no edita (asignación masiva).
//
// Reglas del helper:
//   - Solo entran columnas de una LISTA BLANCA definida en el código de cada ruta.
//   - Una clave que ni siquiera es un identificador SQL válido es un intento de inyección:
//     se rechaza con 400 en vez de ignorarse, para que quede visible en los logs.
//   - Una clave con forma de identificador pero fuera de la lista se IGNORA en silencio:
//     los formularios del frontend reenvían la fila completa del GET (con columnas de
//     JOIN como `numero_trazabilidad`, `bodega_nombre`, `created_at`...) y rechazarlas
//     rompería la edición.
//   - Los valores van siempre por `?`; solo se aceptan escalares (texto, número, booleano,
//     null). mysql2 formatea objetos como `col = valor` y arreglos como listas, lo que
//     altera la sentencia aunque esté escapado.
//   - Los ENUM se validan contra los valores permitidos antes de llegar a MySQL.

const IDENTIFICADOR = /^[A-Za-z_][A-Za-z0-9_]*$/;

class ErrorCampos extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = 'ErrorCampos';
    this.status = 400;
  }
}

// Las columnas y tablas vienen del código (nunca del request); igual se validan para que un
// error de programación no termine concatenando algo raro en el SQL.
function citar(identificador) {
  if (!IDENTIFICADOR.test(identificador)) {
    throw new Error(`Identificador SQL inválido en la definición: ${identificador}`);
  }
  return `\`${identificador}\``;
}

function esEscalar(v) {
  return v === null || ['string', 'number', 'boolean'].includes(typeof v);
}

/**
 * Filtra el body contra la lista blanca y devuelve columnas y valores listos para `?`.
 * @param {object} body           req.body
 * @param {object} opciones
 * @param {string[]} opciones.permitidas  columnas editables
 * @param {Object<string,string[]>} [opciones.enums]  valores válidos por columna ENUM
 * @param {(col:string, v:any) => any} [opciones.normalizar]  transformación por valor
 * @returns {{ columnas: string[], valores: any[], ignoradas: string[] }}
 */
function filtrarCampos(body, { permitidas, enums = {}, normalizar } = {}) {
  if (!Array.isArray(permitidas) || !permitidas.length) {
    throw new Error('filtrarCampos: falta la lista blanca de columnas');
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new ErrorCampos('El cuerpo de la petición debe ser un objeto JSON');
  }
  const lista = new Set(permitidas);
  const columnas = [];
  const valores = [];
  const ignoradas = [];

  for (const clave of Object.keys(body)) {
    if (!IDENTIFICADOR.test(clave)) {
      throw new ErrorCampos(`Campo inválido: ${clave.slice(0, 60)}`);
    }
    if (!lista.has(clave)) { ignoradas.push(clave); continue; }

    let valor = body[clave];
    if (valor === undefined) continue;
    // Igual que antes en todas las rutas: el string vacío de un input borra el valor.
    if (valor === '') valor = null;
    if (!esEscalar(valor)) {
      throw new ErrorCampos(`Valor no permitido para ${clave}`);
    }
    if (normalizar) valor = normalizar(clave, valor);
    const validos = enums[clave];
    if (validos && valor !== null && !validos.includes(valor)) {
      throw new ErrorCampos(`Valor inválido para ${clave}: debe ser uno de ${validos.join(', ')}`);
    }
    columnas.push(clave);
    valores.push(valor);
  }
  return { columnas, valores, ignoradas };
}

/**
 * Arma `UPDATE tabla SET col = ?, ... WHERE id = ?` con la lista blanca.
 * Lanza ErrorCampos (status 400) si no queda ninguna columna, salvo `permitirVacio`,
 * en cuyo caso devuelve sql = null para que la ruta decida.
 */
function construirUpdate({ tabla, id, body, permitidas, enums, normalizar, permitirVacio = false }) {
  const { columnas, valores, ignoradas } = filtrarCampos(body, { permitidas, enums, normalizar });
  if (!columnas.length) {
    if (permitirVacio) return { sql: null, params: [], columnas, ignoradas };
    throw new ErrorCampos('No hay campos para actualizar');
  }
  const sets = columnas.map(c => `${citar(c)} = ?`).join(', ');
  return {
    sql: `UPDATE ${citar(tabla)} SET ${sets} WHERE \`id\` = ?`,
    params: [...valores, id],
    columnas,
    ignoradas,
  };
}

/**
 * "2026-10-01T08:30:00.000Z" -> "2026-10-01 08:30:00"; "2026-10-01T08:30" -> "2026-10-01 08:30".
 * Misma conversión que ya hacía sacrificio.js; se usa solo sobre columnas de fecha para no
 * tocar textos libres (notas) que empiecen con una fecha.
 */
function normalizarFechaIso(v) {
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) {
    return v.replace('T', ' ').replace(/\.\d+Z$/, '').replace(/Z$/, '');
  }
  return v;
}

/** Arma `INSERT INTO tabla (cols) VALUES (?, ...)` a partir de columnas ya filtradas. */
function construirInsert(tabla, columnas, valores) {
  if (!columnas.length) throw new ErrorCampos('No hay campos para insertar');
  const cols = columnas.map(citar).join(', ');
  const marcas = columnas.map(() => '?').join(', ');
  return { sql: `INSERT INTO ${citar(tabla)} (${cols}) VALUES (${marcas})`, params: valores };
}

module.exports = {
  filtrarCampos, construirUpdate, construirInsert, normalizarFechaIso, ErrorCampos, IDENTIFICADOR,
};
