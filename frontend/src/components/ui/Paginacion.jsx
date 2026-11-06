import { ChevronLeft, ChevronRight } from 'lucide-react';

/*
  Paginación para listas largas: dice el rango visible y el total («21–40 de 312 animales»)
  y ofrece Anterior / Siguiente con botones de 44 px.
    <Paginacion pagina={pagina} porPagina={20} total={animales.length} onCambiar={setPagina} nombre="animales" />
  `pagina` empieza en 1. Si todo cabe en una página solo muestra el total.
*/
export default function Paginacion({ pagina, porPagina, total, onCambiar, nombre = 'registros' }) {
  if (!total) return null;
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  const actual = Math.min(Math.max(1, pagina), paginas);
  const desde = (actual - 1) * porPagina + 1;
  const hasta = Math.min(actual * porPagina, total);
  const fmt = (n) => n.toLocaleString('en-US');

  return (
    <nav className="paginacion" aria-label={`Paginación de ${nombre}`}>
      <div aria-live="polite">
        {paginas > 1 ? `${fmt(desde)}–${fmt(hasta)} de ${fmt(total)} ${nombre}` : `${fmt(total)} ${nombre}`}
      </div>
      {paginas > 1 && (
        <div className="paginacion-botones">
          <button type="button" className="btn btn-secondary" onClick={() => onCambiar(actual - 1)} disabled={actual <= 1}>
            <ChevronLeft size={18} aria-hidden="true" /> Anterior
          </button>
          <span className="paginacion-pagina">{actual} / {paginas}</span>
          <button type="button" className="btn btn-secondary" onClick={() => onCambiar(actual + 1)} disabled={actual >= paginas}>
            Siguiente <ChevronRight size={18} aria-hidden="true" />
          </button>
        </div>
      )}
    </nav>
  );
}
