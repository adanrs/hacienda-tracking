import { useState, useEffect, useRef, useId } from 'react';
import { Search, X } from 'lucide-react';
import { api } from '../services/api';

export default function AnimalSearch({ value, onChange, filter }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [animales, setAnimales] = useState([]);
  const ref = useRef();
  const idLista = useId();
  // Opción resaltada con las flechas (−1: ninguna). Con pistola o teclado se elige sin el mouse.
  const [activo, setActivo] = useState(-1);

  useEffect(() => {
    api.getAnimales({ estado: 'activo' }).then(setAnimales).catch(err => console.error('No se pudieron cargar los animales', err));
  }, []);

  useEffect(() => {
    if (value && animales.length) {
      const animal = animales.find(a => a.id === value);
      if (animal) setQuery(`${animal.numero_trazabilidad} - ${animal.nombre || animal.raza}`);
    }
  }, [value, animales]);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Lista filtrada calculada aquí (no leída del estado): el handler de teclado la necesita en el
  // mismo evento en que abre la lista, antes de que React actualice `results`.
  const filtrar = (q) => {
    const lower = q.toLowerCase();
    let filtered = animales.filter(a =>
      a.numero_trazabilidad.toLowerCase().includes(lower) ||
      (a.nombre && a.nombre.toLowerCase().includes(lower)) ||
      (a.raza && a.raza.toLowerCase().includes(lower))
    );
    if (filter) filtered = filtered.filter(filter);
    return filtered.slice(0, 15);
  };

  const handleSearch = (q) => {
    const lista = filtrar(q);
    setQuery(q);
    setOpen(true);
    setResults(lista);
    setActivo(-1);
    return lista;
  };

  const select = (animal) => {
    setQuery(`${animal.numero_trazabilidad} - ${animal.nombre || animal.raza}`);
    setOpen(false);
    onChange(animal.id);
  };

  const clear = () => {
    setQuery('');
    onChange(null);
    setOpen(false);
  };

  const onTecla = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      // Con la lista cerrada, la primera flecha la abre y resalta el primer resultado.
      if (!open) { const lista = handleSearch(query); setActivo(lista.length ? 0 : -1); }
      else setActivo(i => Math.min(results.length - 1, i + 1));
    }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActivo(i => Math.max(0, i - 1)); }
    else if (e.key === 'Enter' && open && results.length) {
      // Enter elige la resaltada, o la única si la búsqueda dejó una sola: no envía el formulario.
      const elegido = results[activo >= 0 ? activo : (results.length === 1 ? 0 : -1)];
      if (elegido) { e.preventDefault(); select(elegido); }
    } else if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); }
  };

  // Combobox accesible: el lector anuncia la lista y la opción activa; las opciones miden 44 px.
  return (
    <div ref={ref} className="buscador-animal">
      <div className="buscador-campo">
        <Search size={16} aria-hidden="true" className="buscador-icono" />
        <input
          role="combobox"
          aria-expanded={open && results.length > 0}
          aria-controls={idLista}
          aria-autocomplete="list"
          aria-activedescendant={activo >= 0 ? `${idLista}-${activo}` : undefined}
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={e => handleSearch(e.target.value)}
          onFocus={() => { if (query) handleSearch(query); else handleSearch(''); }}
          onKeyDown={onTecla}
          placeholder="Buscar por número, nombre o raza…"
        />
        {query && (
          <button type="button" className="btn-icon buscador-limpiar" onClick={clear} aria-label="Quitar animal elegido" title="Quitar">
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </div>
      {open && results.length > 0 && (
        <ul className="buscador-lista" role="listbox" id={idLista}>
          {results.map((a, i) => (
            <li
              key={a.id}
              id={`${idLista}-${i}`}
              role="option"
              aria-selected={i === activo}
              className={i === activo ? 'activa' : ''}
              onMouseDown={e => e.preventDefault()}
              onClick={() => select(a)}
            >
              <span><strong>{a.numero_trazabilidad}</strong> {a.nombre && `· ${a.nombre}`}</span>
              <span className="buscador-meta">{a.raza} · {a.sexo}{a.peso_actual ? ` · ${a.peso_actual} kg` : ''}</span>
            </li>
          ))}
        </ul>
      )}
      {open && query && results.length === 0 && (
        <div className="buscador-lista buscador-vacio" role="status">No se encontraron animales activos con «{query}»</div>
      )}
    </div>
  );
}
