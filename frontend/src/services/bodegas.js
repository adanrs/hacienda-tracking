// Bodegas del núcleo v10 (12, 107, WC-01): llevan su inventario por etiqueta, no por primal/caja.
// Hasta el corte v10 no se ofrecen en los flujos viejos (custodia, maduración, porcionado,
// deshuese, órdenes); el backend también lo valida (backend/src/lib/bodegasV10.js). La única
// excepción es WC-01 como destino de una orden de salida (traslado a la tienda).
// Se reconocen porque tienen `naturaleza`; las BOD-* la tienen vacía.
export const esBodegaV10 = (b) => b != null && b.naturaleza != null;
export const soloLegacy = (bodegas) => (bodegas || []).filter((b) => !esBodegaV10(b));
export const esWc01 = (b) => b != null && b.codigo === 'WC-01';
