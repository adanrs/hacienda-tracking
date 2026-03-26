import { useState, useEffect, useRef } from 'react';
import { Search } from 'lucide-react';
import { api } from '../services/api';

export default function AnimalSearch({ value, onChange, filter }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [animales, setAnimales] = useState([]);
  const ref = useRef();

  useEffect(() => {
    api.getAnimales({ estado: 'activo' }).then(setAnimales);
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

  const handleSearch = (q) => {
    setQuery(q);
    setOpen(true);
    const lower = q.toLowerCase();
    let filtered = animales.filter(a =>
      a.numero_trazabilidad.toLowerCase().includes(lower) ||
      (a.nombre && a.nombre.toLowerCase().includes(lower)) ||
      (a.raza && a.raza.toLowerCase().includes(lower))
    );
    if (filter) filtered = filtered.filter(filter);
    setResults(filtered.slice(0, 15));
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

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <Search size={16} style={{ position: 'absolute', left: 10, top: 10, color: '#9ca3af' }} />
        <input
          value={query}
          onChange={e => handleSearch(e.target.value)}
          onFocus={() => { if (query) handleSearch(query); else handleSearch(''); }}
          placeholder="Buscar por numero, nombre o raza..."
          style={{ paddingLeft: 32, width: '100%' }}
        />
        {query && (
          <button onClick={clear} style={{ position: 'absolute', right: 8, top: 6, background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', color: '#9ca3af' }}>&times;</button>
        )}
      </div>
      {open && results.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
          background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8,
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)', maxHeight: 250, overflowY: 'auto'
        }}>
          {results.map(a => (
            <div key={a.id} onClick={() => select(a)} style={{
              padding: '8px 12px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between',
              borderBottom: '1px solid #f3f4f6', fontSize: '0.85rem'
            }}
              onMouseEnter={e => e.currentTarget.style.background = '#f0fdf4'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <span><strong>{a.numero_trazabilidad}</strong> {a.nombre && `- ${a.nombre}`}</span>
              <span style={{ color: '#6b7280' }}>{a.raza} | {a.sexo} {a.peso_actual ? `| ${a.peso_actual}kg` : ''}</span>
            </div>
          ))}
        </div>
      )}
      {open && query && results.length === 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
          background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '12px', textAlign: 'center', color: '#9ca3af'
        }}>
          No se encontraron animales
        </div>
      )}
    </div>
  );
}
