import { useEffect } from 'react';

/*
  Arreglos de accesibilidad y de uso táctil que valen para TODAS las pantallas, sin reescribir cada
  formulario (mismo enfoque que useEtiquetasTablas). Observa el contenido y, cuando aparece algo:

  1. Formularios: asocia cada <label> de un .form-group con su campo (htmlFor + id). Sin esto,
     tocar «Peso (kg)» no enfocaba el campo y el lector de pantalla anunciaba un campo sin nombre.
  2. Campos numéricos: agrega inputmode para que el celular muestre el teclado numérico
     («decimal» si el paso admite decimales, «numeric» si es entero). Se omite en los que pueden
     llevar signo menos (temperatura, diferencias, ajustes): el teclado decimal de iOS no tiene «-».
  3. Ventanas modales hechas a mano (.modal sin role): role="dialog", aria-modal, título asociado,
     foco al primer campo al abrir y de vuelta al botón que la abrió al cerrar, Tab atrapado y
     Escape para cerrar. Las que ya manejan esto (ui/Modal.jsx, confirmar.jsx) traen role y no se tocan.
  4. Un toque en el fondo NO cierra una ventana que tiene formulario: en tableta, con guantes, un
     toque fuera borraba lo escrito. Se cierra con «Cancelar», la X o Escape.
  5. Casillas de selección en tablas sin etiqueta: nombre accesible con el primer dato de la fila.
*/

const CONTROL = 'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), select, textarea';
const FOCO = 'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';
// Mismo selector, limitado a lo que está dentro de un <form> (cada alternativa lleva el prefijo).
const FOCO_EN_FORM = FOCO.split(', ').map(sel => `form ${sel}`).join(', ');
const PUEDE_SER_NEGATIVO = /temperatura|°|diferencia|ajuste|variaci/i;

let contador = 0;
const nuevoId = (prefijo) => `${prefijo}-${++contador}`;

function asociarEtiquetas(raiz) {
  raiz.querySelectorAll('.form-group > label:not([for]), .campo > label:not([for])').forEach(label => {
    if (label.querySelector('input, select, textarea')) return; // la etiqueta ya envuelve su control
    const control = label.parentElement.querySelector(CONTROL);
    if (!control || control.closest('label')) return;
    if (control.labels && control.labels.length) return;
    if (!control.id) control.id = nuevoId('campo');
    label.htmlFor = control.id;
  });
}

// Casillas de selección sueltas en tablas (sin etiqueta): el lector decía solo «casilla». Se les
// da un nombre con el primer dato de la fila («Seleccionar CJ-0012»).
function nombrarCasillas(raiz) {
  raiz.querySelectorAll('table input[type="checkbox"]:not([aria-label]):not([aria-labelledby])').forEach(casilla => {
    if (casilla.labels && casilla.labels.length) return;
    if (casilla.closest('thead')) { casilla.setAttribute('aria-label', 'Seleccionar todas las filas'); return; }
    const fila = casilla.closest('tr');
    const dato = fila && [...fila.cells].map(c => c.textContent.trim()).find(Boolean);
    casilla.setAttribute('aria-label', dato ? `Seleccionar ${dato}` : 'Seleccionar fila');
  });
}

function tecladoNumerico(raiz) {
  raiz.querySelectorAll('input[type="number"]:not([inputmode])').forEach(input => {
    const min = input.getAttribute('min');
    const etiqueta = input.labels?.[0]?.textContent || input.getAttribute('aria-label') || input.name || '';
    if ((min !== null && Number(min) < 0) || PUEDE_SER_NEGATIVO.test(etiqueta)) return;
    const paso = input.getAttribute('step');
    const entero = !paso || (paso !== 'any' && Number.isInteger(Number(paso)));
    input.setAttribute('inputmode', entero ? 'numeric' : 'decimal');
  });
}

// Ventanas abiertas por este hook → elemento que tenía el foco al abrirse.
const abiertas = new Map();

function prepararDialogos(raiz) {
  raiz.querySelectorAll('.modal:not([role])').forEach(modal => {
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('data-dialogo-auto', '');
    const titulo = modal.querySelector('.modal-header h3, .modal-header h2, h3');
    if (titulo) {
      if (!titulo.id) titulo.id = nuevoId('dialogo-titulo');
      modal.setAttribute('aria-labelledby', titulo.id);
    }
    const cerrar = modal.querySelector('.modal-header button');
    if (cerrar && !cerrar.getAttribute('aria-label')) cerrar.setAttribute('aria-label', 'Cerrar');
    abiertas.set(modal, document.activeElement);
    // Primer campo del cuerpo; si no hay, el primer botón (que no sea la X del encabezado).
    // En pantalla táctil el foco va a la ventana (no a un campo): así no salta el teclado ni se
    // abre la lista del buscador de animal sobre el formulario antes de que la persona lo lea.
    if (window.matchMedia?.('(pointer: coarse)').matches) {
      modal.setAttribute('tabindex', '-1');
      modal.focus({ preventScroll: true });
    } else {
      const primero = modal.querySelector(FOCO_EN_FORM) || [...modal.querySelectorAll(FOCO)].find(el => !el.closest('.modal-header'));
      primero?.focus({ preventScroll: true });
    }
  });
  // Ventanas que se cerraron: el foco vuelve al botón que las abrió.
  abiertas.forEach((previo, modal) => {
    if (modal.isConnected) return;
    abiertas.delete(modal);
    if (previo && previo.isConnected && typeof previo.focus === 'function') previo.focus({ preventScroll: true });
  });
}

function dialogoActivo() {
  const todos = document.querySelectorAll('.modal[role]');
  return todos.length ? todos[todos.length - 1] : null;
}

function onTecla(e) {
  const modal = dialogoActivo();
  if (!modal || !modal.hasAttribute('data-dialogo-auto')) return;
  if (e.key === 'Escape') {
    const boton = modal.querySelector('.modal-header button')
      || [...modal.querySelectorAll('.modal-actions button')].find(b => /cancelar|cerrar/i.test(b.textContent));
    if (boton) { e.preventDefault(); boton.click(); }
    return;
  }
  if (e.key !== 'Tab') return;
  const focos = [...modal.querySelectorAll(FOCO)].filter(el => el.offsetParent !== null);
  if (!focos.length) return;
  const primero = focos[0];
  const ultimo = focos[focos.length - 1];
  if (!modal.contains(document.activeElement)) { e.preventDefault(); primero.focus(); return; }
  if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
  else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
}

// Fase de captura en document: corre antes que el onClick de React (que escucha en #root).
function onClicFondo(e) {
  if (!e.target.classList?.contains('modal-overlay')) return;
  const modal = e.target.querySelector(':scope > .modal[data-dialogo-auto]');
  if (modal && modal.querySelector('form, input, select, textarea')) e.stopPropagation();
}

export default function useAccesibilidadGlobal(ref) {
  useEffect(() => {
    const raiz = ref.current;
    if (!raiz) return undefined;
    let pendiente = 0;
    const aplicar = () => {
      pendiente = 0;
      asociarEtiquetas(raiz);
      tecladoNumerico(raiz);
      nombrarCasillas(raiz);
      prepararDialogos(raiz);
    };
    const programar = () => { if (!pendiente) pendiente = requestAnimationFrame(aplicar); };
    aplicar();
    const obs = new MutationObserver(programar);
    obs.observe(raiz, { childList: true, subtree: true });
    document.addEventListener('keydown', onTecla);
    document.addEventListener('click', onClicFondo, true);
    return () => {
      obs.disconnect();
      if (pendiente) cancelAnimationFrame(pendiente);
      document.removeEventListener('keydown', onTecla);
      document.removeEventListener('click', onClicFondo, true);
    };
  }, [ref]);
}
