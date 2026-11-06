import { useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import { aviso } from './ui/avisos';

/*
  Alta rápida de un corte desde donde aparezca un código nuevo (reporte de producción, solicitud,
  importadores). Es un modal encima de la pantalla: lo digitado allá no se pierde. Al crear, avisa
  al padre (onCreado) para que vuelva a revisar la vista previa con el código ya en el catálogo.
*/
export const TIPOS_CORTE = [
  ['primal', 'Primal'], ['subprimal', 'Subprimal'], ['hueso', 'Hueso'], ['subproducto', 'Subproducto'], ['trimming', 'Trimming'],
  ['retail', 'Retail (porcionado)'], ['grasa', 'Grasa'], ['trim', 'Trim (antiguo)'], ['bch', 'BCH (antiguo)'], ['otro', 'Otro'],
];
export const UNIDADES = [['kg', 'kg'], ['caja', 'Caja'], ['unidad', 'Unidad']];

export default function AltaRapidaCorte({ codigo = '', descripcion = '', onCreado, onCerrar }) {
  const [form, setForm] = useState({ codigo, nombre: descripcion, tipo: 'primal', unidad: 'kg' });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const refPrimero = useRef(null);
  useEffect(() => { refPrimero.current?.focus(); }, []);
  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onCerrar(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onCerrar]);

  const guardar = async (e) => {
    e.preventDefault();
    if (!/^\d{5}$/.test(form.codigo)) { setError('El código debe tener exactamente 5 dígitos'); return; }
    if (!form.nombre.trim()) { setError('Escriba la descripción'); return; }
    setGuardando(true); setError('');
    try {
      const c = await api.createCatalogoCorte({ ...form, nombre: form.nombre.trim(), origen: 'alta_rapida' });
      aviso.ok(`Corte ${c.codigo} agregado al catálogo`);
      onCreado(c);
    } catch (err) { setError(err.message); } finally { setGuardando(false); }
  };

  return (
    <div className="modal-overlay" onClick={onCerrar}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="alta-rapida-titulo" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3 id="alta-rapida-titulo">Agregar corte al catálogo</h3>
          <button type="button" className="btn-icon" aria-label="Cerrar" onClick={onCerrar}>&times;</button>
        </div>
        <form onSubmit={guardar}>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="ar-codigo">Código (5 dígitos) *</label>
              <input id="ar-codigo" ref={refPrimero} inputMode="numeric" maxLength={5} value={form.codigo}
                onChange={e => setForm({ ...form, codigo: e.target.value.replace(/\D/g, '') })} />
            </div>
            <div className="form-group">
              <label htmlFor="ar-nombre">Descripción *</label>
              <input id="ar-nombre" maxLength={200} value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="ar-tipo">Tipo</label>
              <select id="ar-tipo" value={form.tipo} onChange={e => setForm({ ...form, tipo: e.target.value })}>
                {TIPOS_CORTE.slice(0, 5).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="ar-unidad">Unidad</label>
              <select id="ar-unidad" value={form.unidad} onChange={e => setForm({ ...form, unidad: e.target.value })}>
                {UNIDADES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select>
            </div>
          </div>
          {error && <p role="alert" style={{ color: 'var(--error-fuerte)' }}>{error}</p>}
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onCerrar}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={guardando}>{guardando ? 'Guardando…' : 'Agregar al catálogo'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
