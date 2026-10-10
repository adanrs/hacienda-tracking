import { useEffect } from 'react';

/*
  Copia el texto de cada <th> al atributo data-label de las celdas de su columna.
  El CSS lo usa en pantallas < 820 px para mostrar cada fila como tarjeta
  («Estado: abierta») sin tener que tocar cada tabla de cada página.
  Observa el contenedor porque las filas llegan después de cargar los datos.
*/
function etiquetar(raiz) {
  raiz.querySelectorAll('table').forEach(tabla => {
    const encabezados = Array.from(tabla.querySelectorAll('thead th')).map(th => th.textContent.trim());
    if (!encabezados.length) return;
    tabla.querySelectorAll('tbody tr').forEach(tr => {
      Array.from(tr.children).forEach((td, i) => {
        if (td.hasAttribute('colspan') || td.hasAttribute('data-label-fija')) return;
        const etiqueta = encabezados[i] ?? '';
        if (td.getAttribute('data-label') !== etiqueta) td.setAttribute('data-label', etiqueta);
      });
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
    const obs = new MutationObserver(programar);
    obs.observe(raiz, { childList: true, subtree: true });
    return () => { obs.disconnect(); if (pendiente) cancelAnimationFrame(pendiente); };
  }, [ref]);
}
