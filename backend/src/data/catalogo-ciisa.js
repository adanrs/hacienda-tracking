/**
 * Catálogo real de códigos de artículo CIISA «El Arreo» (Sistema de Trazabilidad v10, 8-oct-2026, anexos C1–C4).
 *
 * Módulo de datos puro (sin acceso a MySQL): lo usan el seed de `catalogo_cortes`
 * y el decodificador de etiquetas (`lib/etiquetas.js` → serieDeCodigo).
 *
 * Reglas del documento:
 *  - Todos los códigos los abre CIISA; son los mismos en CIISA, EQTBL y Enlace.
 *  - F1 = serie 266xx, FB = serie 263xx correlativa. La equivalencia F1↔FB se toma
 *    de la tabla C1, NO se calcula (hay FB fuera de serie: 26676, 26680, 26684).
 *  - Vida útil por defecto: congelado 12 meses desde la fecha de etiqueta; primal fresco 90 días.
 *  - Ventanas: cortes 30–90 días tras deshuese; carne molida ≤ 7; chorizo ≤ 90.
 *
 * Campos de cada objeto (coinciden con columnas de catalogo_cortes, salvo `grupo`):
 *  codigo, nombre, nombre_en, tipo, serie, genetica, codigo_equivalente, unidad,
 *  vida_util_dias, vida_congelado_dias, ventana_min_dias, ventana_max_dias, nota_enlace, notas, grupo
 */

const VIDA_CONGELADO = 365; // 12 meses
const VIDA_FRESCO = 90;     // primal fresco

const base = {
  nombre_en: null, genetica: null, codigo_equivalente: null, unidad: 'kg',
  vida_util_dias: VIDA_FRESCO, vida_congelado_dias: VIDA_CONGELADO,
  ventana_min_dias: null, ventana_max_dias: null, nota_enlace: null, notas: null,
};

// ── C1 · Cortes Wagyu con equivalencia F1 ↔ FB ──────────────────────────────
// [nombre, F1, FB, nota Enlace del código FB, nota general del código FB]
const C1 = [
  ['Petite Tender', '26600', '26331'],
  ['Sirloin Cap – Picanha', '26606', '26332', 'Descripción FB en Enlace sin «FB»'],
  ['Flat Iron Steak', '26608', '26333'],
  ['Inside Skirt Steak', '26609', '26334', 'Descripción FB en Enlace sin «FB» («Insade Stirt»)'],
  ['Tri Tip Steak', '26611', '26335', 'Descripción FB en Enlace sin «FB»'],
  ['Ribeye Steak', '26613', '26336'],
  ['Tenderloin Full', '26614', '26337'],
  ['New York Steak', '26617', '26338', 'Descripción FB en Enlace sin «FB»'],
  ['Hanging Tender Roast', '26624', '26339'],
  ['Sirloin Bavette Steak', '26628', '26340'],
  ['Denver Steak', '26632', '26341'],
  ['Full Brisket', '26633', '26342'],
  ['Outside Skirt Steak', '26639', '26343', 'Descripción FB en Enlace sin «FB»'],
  ['Porterhouse', '26643', '26345', 'FB nuevo · crear en Enlace'],
  ['Tenderloin Butt (cabeza de lomito)', '26646', '26346', 'FB nuevo · crear en Enlace'],
  ['T-Bone', '26644', '26347', 'FB nuevo · crear en Enlace'],
  ['Ribeye Filet', '26554', '26676', null, 'FB fuera de la serie 263xx'],
  ['Osobuco', '26640', '26680', null, 'FB fuera de la serie 263xx'],
  ['Cowboy Steak', '26645', '26684', null, 'FB fuera de la serie 263xx'],
];

const cortesC1 = [];
for (const [nombre, f1, fb, notaEnlaceFB = null, notaFB = null] of C1) {
  const comun = { ...base, nombre, nombre_en: nombre, tipo: 'retail', ventana_min_dias: 30, ventana_max_dias: 90, grupo: 'C1' };
  cortesC1.push({ ...comun, codigo: f1, serie: 'F1', genetica: 'F1', codigo_equivalente: fb });
  cortesC1.push({ ...comun, codigo: fb, serie: 'FB', genetica: 'FB', codigo_equivalente: f1, nota_enlace: notaEnlaceFB, notas: notaFB });
}

// ── C2 · Solo F1 y especiales (sin equivalente FB) ──────────────────────────
const c2 = (codigo, nombre, extra = {}) => ({
  ...base, codigo, nombre, nombre_en: nombre, tipo: 'retail', serie: 'F1', genetica: 'F1',
  ventana_min_dias: 30, ventana_max_dias: 90, grupo: 'C2', ...extra,
});
const cortesC2 = [
  c2('26603', 'Short Ribs'),
  c2('26604', 'Short Rib Plate'),
  c2('26626', 'Vegas Strip'),
  c2('26638', 'Ox Tail'),
  c2('26648', 'Sirloin Baseball Cut'),
  c2('26650', 'Chuleta 4S'),
  c2('26652', 'Country Style Ribs'),
  c2('26660', 'Half Rack of Ribs'),
  c2('26662', 'Delmonico / Chuck Eye', { notas: 'Delmonico/Chuck Eye (EQTBL)' }),
  // Primales o piezas enteras sin porcionar (AG = entero)
  c2('26553', 'Ribeye Roll', { tipo: 'primal', notas: 'Primal / pieza entera sin porcionar' }),
  c2('26665', 'Ribeye AG', { tipo: 'primal', notas: 'AG = entero, sin porcionar' }),
  c2('26671', 'Ribeye Bone-In', { tipo: 'primal', notas: 'Primal / pieza entera sin porcionar' }),
  c2('26672', 'Denver CONS', { tipo: 'primal', notas: 'Primal / pieza entera sin porcionar' }),
  c2('26675', 'New York AG', { tipo: 'primal', notas: 'AG = entero, sin porcionar' }),
  c2('26552', 'Tuétano', {
    nombre_en: 'Bone Marrow', tipo: 'subproducto', ventana_min_dias: null, ventana_max_dias: null,
    notas: 'Venta por tienda web; a Arreo se factura con 40114 o 22227',
  }),
];

// ── C3 · Procesados (PVA) ───────────────────────────────────────────────────
const c3 = (codigo, nombre, extra = {}) => ({
  ...base, codigo, nombre, tipo: 'otro', serie: 'PVA', grupo: 'C3', ...extra,
});
const NOTA_MOLIDA_DUP = 'Misma descripción que 26637/26687: depurar duplicados';
const cortesC3 = [
  c3('26636', 'Tortas Wagyu ½ lb', {
    unidad: 'caja',
    notas: 'Incluye Prismar; se controla en cajas, no en kg; pseudo-lotes 0001/0101 sin arete',
  }),
  c3('26649', 'Tortas gourmet'),
  c3('26637', 'Carne molida 2 kg', { ventana_min_dias: 0, ventana_max_dias: 7 }),
  c3('26687', 'Carne molida 500 g', { ventana_min_dias: 0, ventana_max_dias: 7 }),
  c3('26344', 'Carne molida premium 100 %', {
    genetica: 'F1', ventana_min_dias: 0, ventana_max_dias: 7,
    notas: `${NOTA_MOLIDA_DUP}. Sale de animales F1 aunque el código es 263xx`,
  }),
  c3('26642', 'Carne molida premium 100 %', { ventana_min_dias: 0, ventana_max_dias: 7, notas: NOTA_MOLIDA_DUP }),
  c3('29710', 'Chorizo español', { ventana_min_dias: 0, ventana_max_dias: 90, notas: 'Puede salir de recortes' }),
  c3('29711', 'Chorizo blue cheese', { ventana_min_dias: 0, ventana_max_dias: 90, notas: 'Puede salir de recortes' }),
];

// ── C4 · Códigos de planta (Arreo) ──────────────────────────────────────────
const c4 = (codigo, nombre, tipo, notas = null) => ({
  ...base, codigo, nombre, tipo, serie: 'ARREO', grupo: 'C4', notas,
});
const NOTA_SOLO_ARREO = 'Normalmente solo a Arreo';
const NOTA_LOTE_MATANZA = 'Usa lote de matanza, no lote individual';
const cortesC4 = [
  // Trim y BCH
  c4('11163', 'Beef trimmings', 'trim'),
  c4('11164', 'Beef trimmings', 'trim'),
  c4('21327', 'Carne roja B95', 'trim'),
  c4('22229', 'BCH carnes rojas (CH-Chuck)', 'bch'),
  c4('25000', 'BCH Wagyu', 'bch'),
  c4('25002', 'Trimmings', 'trim', 'Se prorratean por peso canal; bolsa granel 60 lb = 27.22 kg nominal'),
  // Primales y postas
  c4('21114', 'Faldilla FLS', 'primal'),
  c4('21115', 'Posta punta solomo', 'primal'),
  c4('21123', 'Posta paleta', 'primal'),
  c4('21136', 'Arrachera', 'primal'),
  c4('21213', 'Posta cacho de vuelta', 'primal'),
  c4('21231', 'Delmonico', 'primal', NOTA_SOLO_ARREO),
  c4('22101', 'Lomitos', 'primal'),
  c4('22104', 'Lomo churrasco', 'primal'),
  c4('22105', 'Lomo aguja', 'primal'),
  c4('22106', 'Posta bolita', 'primal'),
  c4('22107', 'Posta mano piedra', 'primal'),
  c4('22108', 'Posta de cuarto', 'primal'),
  c4('22116', 'Posta vuelta lomo', 'primal'),
  c4('22117', 'Posta solomo', 'primal'),
  c4('22125', 'Posta de entraña', 'primal'),
  c4('22133', 'Posta paleta p/ paquetería', 'primal'),
  c4('22136', 'Carne quititeña', 'primal'),
  c4('22224', 'Carne quititeña', 'primal'),
  c4('22140', 'Cesina', 'primal'),
  c4('22219', 'Cacho de paleta', 'primal'),
  c4('22228', 'Posta de pecho', 'primal'),
  // Costillas y otros
  c4('20000', 'Costilla entera', 'otro'),
  c4('21427', 'Osobuco de res picado', 'otro'),
  c4('22424', 'Osobuco entero', 'otro'),
  c4('22431', 'Costilla picada', 'otro'),
  c4('30124', 'Rabo', 'otro'),
  // Despojos
  c4('40108', 'Lengua', 'subproducto', `Maduración 21 días. ${NOTA_LOTE_MATANZA}`),
  c4('40114', 'Tuétano', 'subproducto'),
  c4('22227', 'Tuétano', 'subproducto'),
  c4('40141', 'Diafragma (outside skirt)', 'subproducto'),
  c4('40170', 'Cheek meat', 'subproducto', NOTA_LOTE_MATANZA),
];

const CATALOGO_CIISA = Object.freeze([...cortesC1, ...cortesC2, ...cortesC3, ...cortesC4].map(Object.freeze));

/** Mapa codigo → entrada, para búsquedas O(1) desde funciones puras. */
const CATALOGO_POR_CODIGO = Object.freeze(Object.fromEntries(CATALOGO_CIISA.map((c) => [c.codigo, c])));

/**
 * Códigos que sembraba la versión anterior (database.js → initDB), casi todos inventados.
 * El seed los desactiva (activo = 0) salvo los que coinciden con un código real (21231 Delmonico).
 */
const CODIGOS_INTERNOS_PREVIOS = Object.freeze([
  '21231', '21253', '21001', '21002', '21003', '21004', '21005', '21006', '21007', '21008',
  '21009', '21010', '21011', '21012', '21013', '21014', '21015', '21016', '21017', '21018',
  '21019', '21020', '21021', '21022', '21023', '21024', '21025', '21026', '30001', '30002', '30003',
]);

module.exports = { CATALOGO_CIISA, CATALOGO_POR_CODIGO, CODIGOS_INTERNOS_PREVIOS, VIDA_CONGELADO, VIDA_FRESCO };
