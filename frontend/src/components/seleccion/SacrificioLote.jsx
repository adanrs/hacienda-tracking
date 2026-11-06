import { useEffect, useState } from 'react';
import { Save, X, RefreshCw } from 'lucide-react';
import { api } from '../../services/api';
import { aviso } from '../ui/avisos';
import Boton from '../ui/Boton';

/*
  Sacrificio de VARIOS animales a la vez. Al elegir la fecha se proponen los animales de la guía de
  transporte de esos días que todavía no tienen sacrificio; se filtran, se marcan y en la tabla se
  escribe peso pie, peso canal, n.º de canal, músculo, dientes, grasa, golpe y condición corporal.
  El rendimiento (canal ÷ pie) se calcula al escribir. Todo o nada, con el error por fila.
*/
const hoy = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Costa_Rica' });
const norm = (s) => String(s || '').toLowerCase();
const CAMPOS = [
  ['peso_vivo', 'Peso pie (kg)', 'number', '0.5'], ['peso_canal_caliente', 'Peso canal (kg)', 'number', '0.1'],
  ['numero_canal', 'N.º canal', 'text'], ['musculo', 'Músculo', 'number', '1'], ['denticion', 'Dientes', 'number', '1'],
  ['grasa', 'Grasa', 'number', '1'], ['golpe', 'Golpe', 'text'], ['condicion_corporal', 'Cond. corporal', 'number', '0.5'],
];

export default function SacrificioLote({ onListo, onCerrar }) {
  const [fecha, setFecha] = useState(hoy());
  const [propuesta, setPropuesta] = useState(null);
  const [filtro, setFiltro] = useState('');
  const [filas, setFilas] = useState({}); // animal_id → { marcado, ...valores }
  const [errores, setErrores] = useState({});
  const [guardando, setGuardando] = useState(false);

  const cargar = () => {
    setPropuesta(null);
    api.getPropuestaSacrificio(fecha).then(p => {
      setPropuesta(p);
      setFilas(Object.fromEntries(p.map(a => [a.animal_id, { marcado: true, peso_vivo: a.peso_salida_kg ?? '' }])));
    }).catch(e => { aviso.error(e.message); setPropuesta([]); });
  };
  useEffect(cargar, [fecha]); // eslint-disable-line react-hooks/exhaustive-deps

  const visibles = (propuesta || []).filter(a => [a.numero_trazabilidad, a.identificacion_electronica, a.potrero_nombre, a.finca, a.guia_numero].some(v => norm(v).includes(norm(filtro))));
  const elegidos = (propuesta || []).filter(a => filas[a.animal_id]?.marcado);
  const set = (id, campo, v) => setFilas(f => ({ ...f, [id]: { ...f[id], [campo]: v } }));
  const marcarFiltrados = (valor) => setFilas(f => { const n = { ...f }; for (const a of visibles) n[a.animal_id] = { ...n[a.animal_id], marcado: valor }; return n; });
  const rend = (v) => (Number(v.peso_vivo) > 0 && Number(v.peso_canal_caliente) > 0 ? ((Number(v.peso_canal_caliente) / Number(v.peso_vivo)) * 100).toFixed(2) : '—');

  const guardar = async () => {
    if (!elegidos.length) { aviso.error('Marque al menos un animal'); return; }
    setGuardando(true); setErrores({});
    try {
      const datos = elegidos.map(a => { const { marcado, ...v } = filas[a.animal_id]; return { animal_id: a.animal_id, ...v }; });
      const r = await api.crearSacrificioLote({ fecha, filas: datos });
      aviso.ok(`Sacrificio registrado para ${r.creados} animal(es)`);
      onListo();
    } catch (e) {
      const det = e.datos?.detalles || [];
      setErrores(Object.fromEntries(det.map(d => [elegidos[d.fila - 1]?.animal_id, d.error])));
      aviso.error(e.message);
    } finally { setGuardando(false); }
  };

  return (
    <div className="card">
      <div className="page-header" style={{ marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>Sacrificio de varios animales</h3>
        <button type="button" className="btn-icon" aria-label="Cerrar" onClick={onCerrar}><X size={18} aria-hidden="true" /></button>
      </div>
      <div className="sel-filtros">
        <div className="form-group"><label htmlFor="sl-fecha">Fecha de sacrificio *</label><input id="sl-fecha" type="date" value={fecha} onChange={e => setFecha(e.target.value)} /></div>
        <div className="form-group"><label htmlFor="sl-filtro">Filtrar (arete, I.E., potrero, finca, guía)</label><input id="sl-filtro" value={filtro} onChange={e => setFiltro(e.target.value)} /></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Boton onClick={() => marcarFiltrados(true)} disabled={!visibles.length}>Marcar filtrados</Boton>
          <Boton onClick={() => marcarFiltrados(false)} disabled={!visibles.length}>Desmarcar</Boton>
          <Boton icono={RefreshCw} onClick={cargar} aria-label="Volver a cargar la propuesta" />
        </div>
      </div>
      <p className="rp-tenue">Se proponen los animales que salieron en una guía de transporte hasta 7 días antes y aún no tienen sacrificio.</p>
      <div className="table-container">
        <table className="sel-tabla">
          <thead><tr><th><span className="sr-only">Incluir</span></th><th>Arete</th><th>Guía</th>{CAMPOS.map(([k, t]) => <th key={k}>{t}</th>)}<th className="num">Rend. %</th><th>Error</th></tr></thead>
          <tbody>
            {propuesta === null && <tr><td colSpan={CAMPOS.length + 5}>Cargando…</td></tr>}
            {propuesta && !propuesta.length && <tr><td colSpan={CAMPOS.length + 5} className="rp-tenue">No hay animales enviados sin sacrificio en los 7 días previos a esa fecha.</td></tr>}
            {visibles.map(a => {
              const v = filas[a.animal_id] || {};
              return (
                <tr key={a.animal_id} className={errores[a.animal_id] ? 'rp-fila-dif' : v.marcado ? '' : 'rp-tenue'}>
                  <td><input type="checkbox" aria-label={`Incluir ${a.numero_trazabilidad}`} checked={Boolean(v.marcado)} onChange={e => set(a.animal_id, 'marcado', e.target.checked)} /></td>
                  <td><strong>{a.numero_trazabilidad}</strong></td>
                  <td>{a.guia_numero || '—'}</td>
                  {CAMPOS.map(([k, t, tipo, paso]) => (
                    <td key={k}><input type={tipo} step={paso} aria-label={`${t} de ${a.numero_trazabilidad}`} disabled={!v.marcado} value={v[k] ?? ''}
                      onChange={e => set(a.animal_id, k, k === 'numero_canal' ? e.target.value.toUpperCase() : e.target.value)} /></td>
                  ))}
                  <td className="num">{rend(v)}</td>
                  <td style={{ color: 'var(--error-fuerte)' }}>{errores[a.animal_id] || ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onCerrar}>Cancelar</button>
        <Boton variante="primario" icono={Save} cargando={guardando} disabled={!elegidos.length} onClick={guardar}>Registrar {elegidos.length} sacrificio(s)</Boton>
      </div>
    </div>
  );
}
