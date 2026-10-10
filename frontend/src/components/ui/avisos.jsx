import { useEffect, useState } from 'react';
import { CircleCheck, CircleX, Info, X } from 'lucide-react';

/*
  Avisos (toasts) para reemplazar window.alert().
  Uso desde cualquier página, sin hooks:
    import { aviso } from '../components/ui/avisos';
    aviso.ok('Caja cerrada');
    aviso.error(err.message);
    api.getCajas().then(setCajas).catch(aviso.errorCarga('las cajas'));
  <Avisos /> se monta una sola vez en App.jsx.
*/

let siguienteId = 1;
let lista = [];
const suscriptores = new Set();

function emitir() {
  suscriptores.forEach(fn => fn(lista));
}

function quitar(id) {
  lista = lista.filter(a => a.id !== id);
  emitir();
}

function mostrar(tipo, mensaje, opciones = {}) {
  const id = siguienteId++;
  const duracion = opciones.duracion ?? (tipo === 'error' ? 9000 : 5000);
  lista = [...lista.slice(-3), { id, tipo, mensaje: String(mensaje || ''), titulo: opciones.titulo }];
  emitir();
  if (duracion > 0) setTimeout(() => quitar(id), duracion);
  return id;
}

export const aviso = {
  ok: (mensaje, opciones) => mostrar('ok', mensaje, opciones),
  info: (mensaje, opciones) => mostrar('info', mensaje, opciones),
  error: (mensaje, opciones) => mostrar('error', mensaje, opciones),
  /** Manejador para .catch() al cargar listas: muestra un error entendible en vez de fallar en silencio. */
  errorCarga: (que = 'los datos') => (err) => {
    console.error(err);
    mostrar('error', err?.message || 'Error desconocido', { titulo: `No se pudieron cargar ${que}` });
  },
  cerrar: quitar,
};

const iconos = { ok: CircleCheck, error: CircleX, info: Info };

export function Avisos() {
  const [items, setItems] = useState(lista);

  useEffect(() => {
    suscriptores.add(setItems);
    return () => { suscriptores.delete(setItems); };
  }, []);

  const errores = items.filter(a => a.tipo === 'error');
  const otros = items.filter(a => a.tipo !== 'error');

  const render = (a) => {
    const Icono = iconos[a.tipo] || Info;
    return (
      <div key={a.id} className={`aviso ${a.tipo}`}>
        <Icono size={22} aria-hidden="true" />
        <div className="aviso-texto">
          {a.titulo && <div className="aviso-titulo">{a.titulo}</div>}
          <div>{a.mensaje}</div>
        </div>
        <button type="button" className="btn-icon" onClick={() => quitar(a.id)} aria-label="Cerrar aviso">
          <X size={16} aria-hidden="true" />
        </button>
      </div>
    );
  };

  // Dos regiones vivas: los errores interrumpen (assertive), el resto se anuncia con calma.
  return (
    <div className="avisos">
      <div role="alert" aria-live="assertive">{errores.map(render)}</div>
      <div role="status" aria-live="polite">{otros.map(render)}</div>
    </div>
  );
}
