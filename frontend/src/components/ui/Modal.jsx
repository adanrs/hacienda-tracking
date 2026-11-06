import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

/*
  Ventana modal accesible con el mismo marcado (.modal-overlay / .modal / .modal-header) que ya
  usan las pantallas, para que las nuevas no tengan que repetir foco, Escape y cierre.
    <Modal abierto={mostrar} titulo="Nuevo animal" icono={Beef} onCerrar={() => setMostrar(false)}
           acciones={<><Boton onClick={cerrar}>Cancelar</Boton><Boton variante="primario" type="submit" form="f-animal">Guardar</Boton></>}>
      <form id="f-animal" onSubmit={…}>…</form>
    </Modal>
  - Al abrir, el foco va al primer campo; al cerrar vuelve al botón que la abrió.
  - Escape cierra (salvo cerrarConEscape={false}); el clic en el fondo NO cierra por omisión,
    porque en tablet un toque fuera borraría un formulario a medio llenar.
  - Tab queda dentro de la ventana.
  - ancho: 'normal' (600 px) | 'ancho' (860 px).
*/
const SELECTOR_FOCO = 'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

export default function Modal({
  abierto = true,
  titulo,
  icono: Icono,
  onCerrar,
  acciones,
  children,
  ancho = 'normal',
  cerrarConEscape = true,
  cerrarAlTocarFondo = false,
}) {
  const id = useId();
  const ref = useRef(null);
  const refPrevio = useRef(null);

  useEffect(() => {
    if (!abierto) return undefined;
    refPrevio.current = document.activeElement;
    const nodo = ref.current;
    const primero = nodo?.querySelector('.modal-cuerpo ' + SELECTOR_FOCO) || nodo?.querySelector(SELECTOR_FOCO);
    primero?.focus();
    const cuerpo = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = cuerpo;
      const previo = refPrevio.current;
      if (previo && typeof previo.focus === 'function') setTimeout(() => previo.focus(), 0);
    };
  }, [abierto]);

  if (!abierto) return null;

  const onKeyDown = (e) => {
    if (e.key === 'Escape' && cerrarConEscape) { e.stopPropagation(); onCerrar?.(); return; }
    if (e.key !== 'Tab') return;
    const focos = Array.from(ref.current?.querySelectorAll(SELECTOR_FOCO) || []);
    if (!focos.length) return;
    const primero = focos[0];
    const ultimo = focos[focos.length - 1];
    if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
    else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
  };

  return (
    <div className="modal-overlay" onMouseDown={cerrarAlTocarFondo ? onCerrar : undefined}>
      <div
        ref={ref}
        className="modal"
        style={ancho === 'ancho' ? { maxWidth: 860 } : undefined}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-titulo`}
        onMouseDown={e => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="modal-header">
          <h3 id={`${id}-titulo`}>{Icono && <Icono size={22} aria-hidden="true" />}{titulo}</h3>
          {onCerrar && (
            <button type="button" className="btn-icon" onClick={onCerrar} aria-label="Cerrar">
              <X size={20} aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="modal-cuerpo">{children}</div>
        {acciones && <div className="modal-actions">{acciones}</div>}
      </div>
    </div>
  );
}
