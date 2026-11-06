// Las tablas v10 que crea la integración (models/nucleoV10.js) deben ser IDÉNTICAS a
// docs/nucleo-inventario-v10/propuesta.sql: si se crearan recortadas, el CREATE TABLE IF NOT
// EXISTS de la migración v10 completa se saltaría en silencio (advertencia de database.js).
// Se comparan columnas (tipo, nulidad, default; sin COMMENT), índices y constraints. La única
// diferencia permitida son las FK diferidas hacia tablas que todavía no existen.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const v10 = require('../src/models/nucleoV10');

const propuesta = fs.readFileSync(path.resolve(__dirname, '../../docs/nucleo-inventario-v10/propuesta.sql'), 'utf8').replace(/\r\n/g, '\n');

function bloque(sql, tabla) {
  const m = new RegExp(`CREATE TABLE IF NOT EXISTS ${tabla} \\(\\n([\\s\\S]*?)\\n\\) ENGINE=InnoDB`).exec(sql);
  assert.ok(m, `no se encontró CREATE TABLE ${tabla}`);
  return m[1];
}

// Parte el cuerpo del CREATE en definiciones de primer nivel (las comas dentro de ENUM(...) o
// de un COMMENT no cortan).
function definiciones(cuerpo) {
  const sinComentariosSql = cuerpo.split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
  const partes = [];
  let actual = '';
  let prof = 0;
  let enTexto = false;
  for (let i = 0; i < sinComentariosSql.length; i++) {
    const ch = sinComentariosSql[i];
    if (ch === "'" && sinComentariosSql[i - 1] !== '\\') enTexto = !enTexto;
    if (!enTexto) {
      if (ch === '(') prof++;
      if (ch === ')') prof--;
      if (ch === ',' && prof === 0) { partes.push(actual.trim()); actual = ''; continue; }
    }
    actual += ch;
  }
  if (actual.trim()) partes.push(actual.trim());
  return partes.map(p => p.replace(/\s+COMMENT\s+'(?:[^'\\]|\\.)*'/g, '').replace(/\s+/g, ' ').trim());
}

function esquema(sql, tabla) {
  const columnas = {};
  const otros = new Set();
  for (const d of definiciones(bloque(sql, tabla))) {
    if (/^(PRIMARY|UNIQUE|KEY|CONSTRAINT|INDEX)\b/.test(d)) otros.add(d);
    else { const [nombre, ...resto] = d.split(' '); columnas[nombre] = resto.join(' '); }
  }
  return { columnas, otros };
}

const diferidas = new Set(v10.FK_DIFERIDAS.map(f => f.fk));

for (const [tabla, sql] of [
  ['etiquetas', v10.SQL_ETIQUETAS],
  ['movimientos_etiqueta', v10.SQL_MOVIMIENTOS_ETIQUETA],
  ['formatos_etiqueta', v10.SQL_FORMATOS_ETIQUETA],
  ['consecutivos', v10.SQL_CONSECUTIVOS],
]) {
  test(`${tabla}: misma definición que propuesta.sql`, () => {
    const nuestro = esquema(sql, tabla);
    const prop = esquema(propuesta, tabla);
    assert.deepEqual(nuestro.columnas, prop.columnas);
    const faltan = [...prop.otros].filter(d => !nuestro.otros.has(d));
    const sobran = [...nuestro.otros].filter(d => !prop.otros.has(d));
    // Lo único que puede faltar son FK diferidas (se agregan cuando exista su tabla).
    for (const d of faltan) {
      const fk = /^CONSTRAINT (\w+) FOREIGN KEY/.exec(d);
      assert.ok(fk && diferidas.has(fk[1]), `falta en nucleoV10.js: ${d}`);
    }
    assert.deepEqual(sobran, [], 'nucleoV10.js tiene definiciones que no están en propuesta.sql');
  });
}

test('las FK diferidas son las de propuesta.sql, con la misma definición', () => {
  for (const f of v10.FK_DIFERIDAS) {
    const enLinea = propuesta.includes(`CONSTRAINT ${f.fk} ${f.def}`);
    const porCall = propuesta.includes(`'${f.fk}',\n  '${f.def}'`);
    assert.ok(enLinea || porCall, `${f.fk} no coincide con propuesta.sql`);
  }
});

test('bodegas: las columnas v10 agregadas coinciden con propuesta.sql §1.2', () => {
  for (const [col, def] of v10.BODEGAS_COLUMNAS) {
    assert.ok(propuesta.includes(`CALL v10_add_column('bodegas', '${col}',\n  "${def}");`), `bodegas.${col} difiere de propuesta.sql`);
  }
});

test('bodegas sembradas (12, 107, WC-01) iguales a la semilla de propuesta.sql §14', () => {
  for (const [codigo, nombre, tipo, naturaleza, ambito, custodio, propietaria, ciisa] of v10.BODEGAS_V10) {
    const q = (v) => (v === null ? 'NULL' : `'${v}'`);
    const fila = new RegExp(`\\(${q(codigo)},\\s+${q(nombre).replace(/[()]/g, '\\$&')},\\s+${q(tipo)},\\s+${q(naturaleza)},\\s+${q(ambito)},\\s+${q(custodio)},\\s+${q(propietaria)},\\s+${q(ciisa)},\\s+1\\)`);
    assert.match(propuesta, fila, `bodega ${codigo}`);
  }
});
