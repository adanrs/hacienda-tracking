import { useEffect } from 'react';

/*
  Recorre las tablas del contenido y hace dos cosas, sin tener que tocar cada página:
  1. Copia el texto de cada <th> al atributo data-label de las celdas de su columna.
     El CSS lo usa en pantallas < 820 px para mostrar cada fila como tarjeta
     («Estado: abierta»).
  2. Marca con la clase .num las columnas cuyas celdas son todas cifras (pesos, cantidades,
     porcentajes, temperaturas). El CSS las alinea a la derecha con cifras tabulares, para que
     «179.00 kg» y «1,286.50 kg» se comparen de un vistazo.
  Observa el contenedor porque las filas llegan después de cargar los datos.
*/

// Cifra con separadores y una unidad corta opcional: «179.00 kg», «55.11%», «-2.5 °C», «12 días».
// Las fechas (15/11/2025) y los códigos (HT-0011, OE-2026-001) no coinciden: quedan a la izquierda.
const NUMERICO = /^[-+−]?(?:₡|\$)?\s?\d[\d,.\s]*(?:\s?(?:kg|g|lb|%|°c|°|d|días?|h|cajas?|uds?\.?|unidades|piezas?))?$/i;
const VACIO = /^(?:-|—|–|n\/a)?$/i;

function esColumnaNumerica(celdas) {
  let cifras = 0;
  for (const td of celdas) {
    // Celdas con controles (botones, inputs) no son datos para alinear.
    if (td.querySelector('button, input, select, a')) return false;
    const texto = td.textContent.trim();
    if (VACIO.test(texto)) continue;
    if (!NUMERICO.test(texto)) return false;
    cifras += 1;
  }
  return cifras > 0;
}

function marcar(el, activo) {
  if (activo && !el.classList.contains('num')) el.classList.add('num');
  else if (!activo && el.classList.contains('num') && el.hasAttribute('data-num-auto')) el.classList.remove('num');
  if (activo) el.setAttribute('data-num-auto', '');
}

function etiquetar(raiz) {
  raiz.querySelectorAll('table').forEach(tabla => {
    const ths = Array.from(tabla.querySelectorAll('thead th'));
    const encabezados = ths.map(th => th.textContent.trim());
    if (!encabezados.length) return;
    const columnas = encabezados.map(() => []);
    tabla.querySelectorAll('tbody tr').forEach(tr => {
      Array.from(tr.children).forEach((td, i) => {
        if (td.hasAttribute('colspan')) return;
        if (columnas[i]) columnas[i].push(td);
        if (td.hasAttribute('data-label-fija')) return;
        const etiqueta = encabezados[i] ?? '';
        if (td.getAttribute('data-label') !== etiqueta) td.setAttribute('data-label', etiqueta);
      });
    });
    // Solo columnas sin clase propia: si la página ya decidió la alineación, se respeta.
    columnas.forEach((celdas, i) => {
      const th = ths[i];
      if (!th || !celdas.length) return;
      if (th.classList.contains('num') && !th.hasAttribute('data-num-auto')) return;
      const numerica = esColumnaNumerica(celdas);
      marcar(th, numerica);
      celdas.forEach(td => marcar(td, numerica));
    });
  });
}

export default function useEtiquetasTablas(ref) {
  useEffect(() => {
    const raiz = ref.current;
    if (!raiz) return undefined;
    let pendiente = 0;
    const programar = () => {
      if (pendiente) return;
      pendiente = requestAnimationFrame(() => { pendiente = 0; etiquetar(raiz); });
    };
    etiquetar(raiz);
    // Solo childList/characterData: los cambios de atributos que hace etiquetar() no lo vuelven a disparar.
    const obs = new MutationObserver(programar);
    obs.observe(raiz, { childList: true, subtree: true, characterData: true });
    return () => { obs.disconnect(); if (pendiente) cancelAnimationFrame(pendiente); };
  }, [ref]);
}
