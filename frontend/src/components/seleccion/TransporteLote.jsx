import { useEffect, useMemo, useState } from 'react';
import { CheckSquare, Square, Save, X } from 'lucide-react';
import { api } from '../../services/api';
import { aviso } from '../ui/avisos';
import Boton from '../ui/Boton';

/*
  Transporte de VARIOS animales a la vez (antes era uno por uno). Se filtra por arete, I.E.,
  potrero o finca, se marcan los animales (o «todos los filtrados») y en la tabla se escribe el peso
  de salida y la condición corporal de cada uno. Todo o nada: si una fila tiene un error, no se
  guarda ninguna y se señala cuál.
*/
const hoy = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Costa_Rica' });
const norm = (s) => String(s || '').toLowerCase();

export default function TransporteLote({ onListo, onCerrar }) {
  const [animales, setAnimales] = useState(null);
  const [filtro, setFiltro] = useState({ arete: '', ie: '', potrero: '', finca: '' });
  const [marcados, setMarcados] = useState({}); // animal_id → { peso_pie_finca, condicion_corporal }
  const [enc, setEnc] = useState({ fecha_salida: hoy(), tipo: 'matadero', destino: '', transportista: '', placa_vehiculo: '', guia_movilizacion: '' });
  const [errores, setErrores] = useState({});
  const [guardando, setGuardando] = useState(false);

  useEffect(() => { api.getAnimales({ estado: 'activo' }).then(setAnimales).catch(e => { aviso.error(e.message); setAnimales([]); }); }, []);

  const filtrados = useMemo(() => (animales || []).filter(a =>
    norm(a.numero_trazabilidad).includes(norm(filtro.arete))
    && norm(a.identificacion_electronica).includes(norm(filtro.ie))
    && norm(a.potrero_nombre).includes(norm(filtro.potrero))
    && norm(a.finca).includes(norm(filtro.finca))), [animales, filtro]);

  const alternar = (a) => setMarcados(m => {
    const n = { ...m };
    if (n[a.id]) delete n[a.id]; else n[a.id] = { peso_pie_finca: a.peso_actual ?? '', condicion_corporal: '' };
    return n;
  });
  const todosFiltrados = () => setMarcados(m => {
    const n = { ...m };
    for (const a of filtrados) if (!n[a.id]) n[a.id] = { peso_pie_finca: a.peso_actual ?? '', condicion_corporal: '' };
    return n;
  });
  const elegidos = (animales || []).filter(a => marcados[a.id]);
  const set = (id, campo, v) => setMarcados(m => ({ ...m, [id]: { ...m[id], [campo]: v } }));

  const guardar = async () => {
    if (!elegidos.length) { aviso.error('Marque al menos un animal'); return; }
    setGuardando(true); setErrores({});
    try {
      const r = await api.crearTransporteLote({ ...enc, filas: elegidos.map(a => ({ animal_id: a.id, ...marcados[a.id] })) });
      aviso.ok(`Transporte registrado para ${r.creados} animal(es)`);
      onListo();
    } catch (e) {
      const det = e.datos?.detalles || [];
      setErrores(Object.fromEntries(det.map(d => [elegidos[d.fila - 1]?.id, d.error])));
      aviso.error(e.message);
    } finally { setGuardando(false); }
  };

  return (
    <div className="card">
      <div className="page-header" style={{ marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>Transporte de varios animales</h3>
        <button type="button" className="btn-icon" aria-label="Cerrar" onClick={onCerrar}><X size={18} aria-hidden="true" /></button>
      </div>
      <div className="sel-filtros">
        <div className="form-group"><label htmlFor="tl-fecha">Fecha de salida *</label><input id="tl-fecha" type="date" value={enc.fecha_salida} onChange={e => setEnc({ ...enc, fecha_salida: e.target.value })} /></div>
        <div className="form-group"><label htmlFor="tl-tipo">Tipo</label>
          <select id="tl-tipo" value={enc.tipo} onChange={e => setEnc({ ...enc, tipo: e.target.value })}>
            <option value="matadero">Planta (sacrificio)</option><option value="finca">Otra finca</option><option value="feria">Feria</option><option value="otro">Otro</option>
          </select></div>
        <div className="form-group"><label htmlFor="tl-destino">Destino</label><input id="tl-destino" value={enc.destino} onChange={e => setEnc({ ...enc, destino: e.target.value })} placeholder="CIISA El Arreo" /></div>
        <div className="form-group"><label htmlFor="tl-trans">Transportista</label><input id="tl-trans" value={enc.transportista} onChange={e => setEnc({ ...enc, transportista: e.target.value })} /></div>
        <div className="form-group"><label htmlFor="tl-placa">Placa</label><input id="tl-placa" value={enc.placa_vehiculo} onChange={e => setEnc({ ...enc, placa_vehiculo: e.target.value })} /></div>
        <div className="form-group"><label htmlFor="tl-guia">Guía SENASA</label><input id="tl-guia" value={enc.guia_movilizacion} onChange={e => setEnc({ ...enc, guia_movilizacion: e.target.value })} /></div>
      </div>

      <h4>1. Elija los animales</h4>
      <div className="sel-filtros">
        {[['arete', 'Arete'], ['ie', 'I.E. (chip)'], ['potrero', 'Potrero'], ['finca', 'Finca']].map(([k, t]) => (
          <div className="form-group" key={k}><label htmlFor={`tl-f-${k}`}>{t}</label><input id={`tl-f-${k}`} value={filtro[k]} onChange={e => setFiltro({ ...filtro, [k]: e.target.value })} /></div>
        ))}
        <Boton icono={CheckSquare} onClick={todosFiltrados} disabled={!filtrados.length}>Marcar los {filtrados.length} filtrados</Boton>
      </div>
      <div className="table-container" style={{ maxHeight: 280, overflowY: 'auto' }}>
        <table className="sel-tabla">
          <thead><tr><th><span className="sr-only">Marcar</span></th><th>Arete</th><th>I.E.</th><th>Potrero</th><th>Finca</th><th className="num">Último peso</th></tr></thead>
          <tbody>
            {animales === null && <tr><td colSpan={6}>Cargando…</td></tr>}
            {filtrados.slice(0, 300).map(a => (
              <tr key={a.id} onClick={() => alternar(a)} style={{ cursor: 'pointer' }}>
                <td><input type="checkbox" aria-label={`Marcar ${a.numero_trazabilidad}`} checked={Boolean(marcados[a.id])} onChange={() => alternar(a)} onClick={e => e.stopPropagation()} /></td>
                <td><strong>{a.numero_trazabilidad}</strong></td><td>{a.identificacion_electronica || '—'}</td><td>{a.potrero_nombre || '—'}</td><td>{a.finca || '—'}</td>
                <td className="num">{a.peso_actual ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h4>2. Revise y complete ({elegidos.length} animal(es))</h4>
      {elegidos.length > 0 && (
        <div className="table-container">
          <table className="sel-tabla">
            <thead><tr><th><span className="sr-only">Quitar</span></th><th>Arete</th><th>Peso de salida (kg)</th><th>Condición corporal (1–9)</th><th>Error</th></tr></thead>
            <tbody>
              {elegidos.map(a => (
                <tr key={a.id} className={errores[a.id] ? 'rp-fila-dif' : ''}>
                  <td><button type="button" className="btn-icon" aria-label={`Quitar ${a.numero_trazabilidad}`} onClick={() => alternar(a)}><Square size={16} aria-hidden="true" /></button></td>
                  <td><strong>{a.numero_trazabilidad}</strong></td>
                  <td><input type="number" step="0.5" min="50" max="1500" aria-label={`Peso de salida de ${a.numero_trazabilidad}`} value={marcados[a.id].peso_pie_finca} onChange={e => set(a.id, 'peso_pie_finca', e.target.value)} /></td>
                  <td><input type="number" step="1" min="1" max="9" aria-label={`Condición corporal de ${a.numero_trazabilidad}`} value={marcados[a.id].condicion_corporal} onChange={e => set(a.id, 'condicion_corporal', e.target.value)} /></td>
                  <td style={{ color: 'var(--error-fuerte)' }}>{errores[a.id] || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onCerrar}>Cancelar</button>
        <Boton variante="primario" icono={Save} cargando={guardando} disabled={!elegidos.length} onClick={guardar}>Registrar {elegidos.length} transporte(s)</Boton>
      </div>
    </div>
  );
}
