import { useEffect, useRef, useState } from 'react';
import { TriangleAlert, CircleHelp } from 'lucide-react';

/*
  Diálogo de confirmación propio (reemplaza window.confirm()).
  Uso:
    import { confirmar } from '../components/ui/confirmar';
    if (!(await confirmar({ titulo: '¿Eliminar este pesaje?', mensaje: 'No se puede deshacer.', textoConfirmar: 'Eliminar', peligro: true }))) return;
  <DialogoConfirmacion /> se monta una sola vez en App.jsx.
  - En acciones peligrosas el foco inicial queda en «Cancelar» (Enter de una pistola no borra nada por accidente).
  - Escape o clic fuera = cancelar. Tab queda dentro del diálogo. Al cerrar, el foco vuelve a donde estaba.
*/

let abrirDialogo = null;

export function confirmar(opciones) {
  const o = typeof opciones === 'string' ? { titulo: opciones } : opciones;
  if (!abrirDialogo) return Promise.resolve(window.confirm(o.titulo));
  return new Promise(resolve => abrirDialogo({ ...o, resolve }));
}

export function DialogoConfirmacion() {
  const [actual, setActual] = useState(null);
  const refCancelar = useRef(null);
  const refConfirmar = useRef(null);
  const refPrevio = useRef(null);

  useEffect(() => {
    abrirDialogo = (o) => {
      refPrevio.current = document.activeElement;
      setActual(o);
    };
    return () => { abrirDialogo = null; };
  }, []);

  useEffect(() => {
    if (!actual) return;
    const destino = actual.peligro ? refCancelar.current : refConfirmar.current;
    destino?.focus();
  }, [actual]);

  if (!actual) return null;

  const cerrar = (valor) => {
    actual.resolve(valor);
    setActual(null);
    const previo = refPrevio.current;
    if (previo && typeof previo.focus === 'function') setTimeout(() => previo.focus(), 0);
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); cerrar(false); }
    if (e.key === 'Tab') {
      const botones = [refCancelar.current, refConfirmar.current];
      const i = botones.indexOf(document.activeElement);
      e.preventDefault();
      botones[(i + (e.shiftKey ? -1 : 1) + botones.length) % botones.length]?.focus();
    }
  };

  const Icono = actual.peligro ? TriangleAlert : CircleHelp;

  return (
    <div className="modal-overlay" onMouseDown={() => cerrar(false)}>
      <div
        className="modal dialogo"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dialogo-titulo"
        aria-describedby={actual.mensaje ? 'dialogo-mensaje' : undefined}
        onMouseDown={e => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="dialogo-cuerpo">
          <div className={`dialogo-icono ${actual.peligro ? 'peligro' : ''}`}><Icono size={22} aria-hidden="true" /></div>
          <div>
            <h3 id="dialogo-titulo">{actual.titulo}</h3>
            {actual.mensaje && <p id="dialogo-mensaje">{actual.mensaje}</p>}
          </div>
        </div>
        <div className="modal-actions">
          <button ref={refCancelar} type="button" className="btn btn-secondary" onClick={() => cerrar(false)}>
            {actual.textoCancelar || 'Cancelar'}
          </button>
          <button ref={refConfirmar} type="button" className={`btn ${actual.peligro ? 'btn-danger' : 'btn-primary'}`} onClick={() => cerrar(true)}>
            {actual.textoConfirmar || 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  );
}
