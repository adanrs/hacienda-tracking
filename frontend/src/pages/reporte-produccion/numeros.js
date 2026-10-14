// Lectura de números digitados o pegados. MISMA regla que backend/src/lib/reporteProduccion.js
// (parsearNumero): si la pantalla leyera «0,500» o «12,345» distinto que el servidor, el total
// que ve el usuario antes de guardar no sería el que se guarda. Un test del backend compara
// ambas funciones con los mismos casos (backend/test/reporte-produccion.test.js).
//   «97.40», «97,40» → 97.4 · «0,500» → 0.5 · «12,345» / «1,250» → miles (12345 / 1250)
//   «1.234,56» y «1,234.56» → 1234.56 · cualquier otra cosa → NaN
export function numeroDe(valor) {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : NaN;
  if (valor === null || valor === undefined) return NaN;
  let s = String(valor).trim().replace(/\s/g, '');
  if (!s) return NaN;
  const coma = s.lastIndexOf(',');
  const punto = s.lastIndexOf('.');
  if (coma >= 0 && punto >= 0) {
    // El separador que aparece último es el decimal; el otro es de miles.
    if (coma > punto) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (coma >= 0) {
    // Una sola coma es decimal, salvo que tenga forma de miles («1,250»); «0,500» siempre es decimal.
    const unica = /^-?\d+,\d{1,3}$/.test(s);
    const formaMiles = /^-?[1-9]\d{0,2}(,\d{3})+$/.test(s);
    s = unica && !formaMiles ? s.replace(',', '.') : s.replace(/,/g, '');
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN;
  return Number(s);
}
