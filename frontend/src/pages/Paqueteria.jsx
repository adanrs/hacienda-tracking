import { useState, useEffect, useRef } from 'react';
import { Plus, Trash2, CheckSquare, FileSpreadsheet, ScanLine, AlertTriangle } from 'lucide-react';
import { api } from '../services/api';
import { formatDate } from '../components/DateFormat';

const estadoBadge = { en_proceso: 'badge-yellow', terminado: 'badge-green', despachado: 'badge-blue' };
const tipoLabel = { carne_molida: 'Carne Molida', chorizo: 'Chorizo', tortas: 'Tortas', hamburguesa: 'Hamburguesa', otro: 'Otro' };
const tempLabel = { fresco: 'Fresco', madurado: 'Madurado', congelado: 'Congelado' };

const API_BASE = import.meta.env.VITE_API_URL || '/api';

// Plazos (dias)
const PLAZO_FRESCO_MAD = 7;
const PLAZO_CONGELADO = 365;

function plazoInfo(temporalidad, dias) {
  if (dias === null || dias === undefined || dias === '') return null;
  const d = parseInt(dias, 10);
  if (isNaN(d)) return null;
  if (temporalidad === 'congelado') {
    if (d > PLAZO_CONGELADO) return { ok: false, label: `EXCEDE ${PLAZO_CONGELADO} DÍAS`, restantes: 0 };
    return { ok: true, label: `OK • ${PLAZO_CONGELADO - d}d`, restantes: PLAZO_CONGELADO - d };
  }
  // fresco / madurado / default
  if (d > PLAZO_FRESCO_MAD) return { ok: false, label: `EXCEDE ${PLAZO_FRESCO_MAD} DÍAS`, restantes: 0 };
  return { ok: true, label: `OK • ${PLAZO_FRESCO_MAD - d}d`, restantes: PLAZO_FRESCO_MAD - d };
}

function PlazoBadge({ temporalidad, dias }) {
  const info = plazoInfo(temporalidad, dias);
  if (!info) return <span style={{ color: '#9ca3af' }}>-</span>;
  const style = {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 12,
    fontSize: '0.75rem',
    fontWeight: 600,
    background: info.ok ? '#dcfce7' : '#fee2e2',
    color: info.ok ? '#166534' : '#991b1b',
  };
  return <span style={style}>{info.label}</span>;
}

export default function Paqueteria() {
  const [productos, setProductos] = useState([]);
  const [animales, setAnimales] = useState([]);
  const [porcionados, setPorcionados] = useState([]);
  const [showNew, setShowNew] = useState(false);
  const [showView, setShowView] = useState(null);
  const [terminarModal, setTerminarModal] = useState(null);
  const [pesoFinal, setPesoFinal] = useState('');
  const [form, setForm] = useState({});
  const [fuentes, setFuentes] = useState([]);

  // Scanner state
  const [scanTemporalidad, setScanTemporalidad] = useState('fresco');
  const [scanCodigo, setScanCodigo] = useState('');
  const [scanError, setScanError] = useState(null);
  const [scanLoading, setScanLoading] = useState(false);
  const [pendingScan, setPendingScan] = useState(null); // {codigo_lot, temporalidad, msg} para confirmar bypass
  const scanInputRef = useRef(null);

  const load = () => api.getPaqueteria().then(setProductos).catch(console.error);
  useEffect(() => {
    load();
    api.getAnimales().then(setAnimales).catch(console.error);
    api.getPorcionado().then(setPorcionados).catch(console.error);
  }, []);

  useEffect(() => {
    if (showNew && scanInputRef.current) {
      setTimeout(() => scanInputRef.current && scanInputRef.current.focus(), 100);
    }
  }, [showNew]);

  const nowLocal = () => {
    const d = new Date();
    const off = d.getTimezoneOffset();
    const local = new Date(d.getTime() - off * 60000);
    return local.toISOString().slice(0, 16);
  };

  const newFuenteRow = () => ({
    animal_id: '',
    origen: 'trim',
    peso_kg: '',
    porcionado_id: '',
    temporalidad: 'fresco',
    codigo_box: '',
    codigo_lot: '',
    fecha_ingreso: nowLocal(),
    dias_desde_deshuese: null,
  });

  const openNew = () => {
    setForm({ fecha: new Date().toISOString().split('T')[0], tipo_producto: 'carne_molida', aditivos_kg: 0 });
    setFuentes([newFuenteRow()]);
    setScanCodigo('');
    setScanError(null);
    setPendingScan(null);
    setShowNew(true);
  };

  const addFuente = () => setFuentes([...fuentes, newFuenteRow()]);
  const removeFuente = (i) => setFuentes(fuentes.filter((_, idx) => idx !== i));
  const updateFuente = (i, k, v) => { const n = [...fuentes]; n[i] = { ...n[i], [k]: v }; setFuentes(n); };

  // Llama al backend scan-fuente. Devuelve { ok, data, status, error, requiresForce }
  const callScanFuente = async (codigo_lot, temporalidad, force = false) => {
    const token = localStorage.getItem('token');
    const url = `${API_BASE}/paqueteria/scan-fuente${force ? '?force=1' : ''}`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          codigo_lot,
          peso_kg: 0,
          paqueteria_id: null, // todavía no creado, el backend solo busca el deshuese
          temporalidad,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errMsg = body.error || body.message || `Error ${res.status}`;
        const requiresForce = res.status === 400 && /plazo|día|excede|exceeded/i.test(errMsg);
        return { ok: false, status: res.status, error: errMsg, requiresForce };
      }
      return { ok: true, data: body };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };

  const handleScan = async (force = false) => {
    const codigo = (force ? pendingScan?.codigo_lot : scanCodigo).trim();
    const temp = force ? pendingScan.temporalidad : scanTemporalidad;
    if (!codigo) return;
    setScanLoading(true);
    setScanError(null);
    const r = await callScanFuente(codigo, temp, force);
    setScanLoading(false);

    if (r.ok) {
      // El backend devuelve la fuente / info del deshuese
      const d = r.data || {};
      const newRow = {
        ...newFuenteRow(),
        animal_id: d.animal_id || '',
        origen: d.origen || 'trim',
        peso_kg: d.peso_kg || '',
        porcionado_id: d.porcionado_id || '',
        temporalidad: temp,
        codigo_box: d.codigo_box || '',
        codigo_lot: d.codigo_lot || codigo,
        fecha_ingreso: d.fecha_ingreso || nowLocal(),
        dias_desde_deshuese: d.dias_desde_deshuese ?? null,
      };
      setFuentes(prev => {
        // Si la primera fila está vacía la reemplaza, sino la agrega
        const first = prev[0];
        const firstEmpty = first && !first.animal_id && !first.codigo_lot && !first.peso_kg;
        if (firstEmpty && prev.length === 1) return [newRow];
        return [...prev, newRow];
      });
      setScanCodigo('');
      setPendingScan(null);
      if (scanInputRef.current) scanInputRef.current.focus();
      return;
    }

    if (r.requiresForce) {
      setPendingScan({ codigo_lot: codigo, temporalidad: temp, msg: r.error });
      return;
    }
    setScanError(r.error || 'Error escaneando');
  };

  const onScanKey = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleScan(false);
    }
  };

  const save = async (e) => {
    e.preventDefault();
    const totalFuentes = fuentes.reduce((s, f) => s + parseFloat(f.peso_kg || 0), 0);
    if (totalFuentes <= 0) return alert('Debe ingresar al menos una fuente con peso');
    if (!form.peso_entrada_kg) form.peso_entrada_kg = totalFuentes;
    try {
      const fuentesPayload = fuentes
        .filter(f => f.animal_id && f.peso_kg)
        .map(f => ({
          animal_id: f.animal_id,
          origen: f.origen,
          peso_kg: f.peso_kg,
          porcionado_id: f.porcionado_id || null,
          temporalidad: f.temporalidad || 'fresco',
          codigo_box: f.codigo_box || null,
          codigo_lot: f.codigo_lot || null,
          fecha_ingreso: f.fecha_ingreso || null,
        }));
      await api.createPaqueteria({ ...form, fuentes: fuentesPayload });
      setShowNew(false);
      load();
    } catch (err) { alert(err.message); }
  };

  const ver = async (id) => {
    try { const r = await api.getPaqueteriaOne(id); setShowView(r); } catch (err) { alert(err.message); }
  };

  const openTerminar = (p) => { setTerminarModal(p); setPesoFinal(''); };

  const confirmarTerminar = async (e) => {
    e.preventDefault();
    if (!pesoFinal || parseFloat(pesoFinal) <= 0) return alert('Peso final requerido');
    try {
      await api.terminarPaqueteria(terminarModal.id, parseFloat(pesoFinal));
      setTerminarModal(null);
      load();
    } catch (err) { alert(err.message); }
  };

  const totalEntrada = fuentes.reduce((s, f) => s + parseFloat(f.peso_kg || 0), 0);

  return (
    <div>
      <div className="page-header">
        <h2>Productos de Paquetería</h2>
        <button className="btn btn-primary" onClick={openNew}><Plus size={16} /> Nuevo Lote</button>
      </div>

      <div className="card">
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Lote</th>
                <th>Tipo</th>
                <th>Fecha</th>
                <th>Peso Entrada</th>
                <th>Peso Final</th>
                <th>Rendimiento</th>
                <th>Responsable</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {productos.map(p => (
                <tr key={p.id}>
                  <td><strong>{p.numero_lote}</strong></td>
                  <td>{tipoLabel[p.tipo_producto] || p.tipo_producto}</td>
                  <td>{formatDate(p.fecha)}</td>
                  <td>{parseFloat(p.peso_entrada_kg).toFixed(3)} kg</td>
                  <td>{p.peso_final_kg ? `${parseFloat(p.peso_final_kg).toFixed(3)} kg` : '-'}</td>
                  <td>{p.rendimiento_pct ? <span className={parseFloat(p.rendimiento_pct) >= 90 ? 'rendimiento-high' : parseFloat(p.rendimiento_pct) >= 75 ? 'rendimiento-mid' : 'rendimiento-low'}>{parseFloat(p.rendimiento_pct).toFixed(2)}%</span> : '-'}</td>
                  <td>{p.responsable || '-'}</td>
                  <td><span className={`badge ${estadoBadge[p.estado] || 'badge-gray'}`}>{p.estado}</span></td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn-icon" onClick={() => ver(p.id)} title="Ver y prorrateo"><FileSpreadsheet size={16} /></button>
                      {p.estado === 'en_proceso' && (
                        <button className="btn-icon" onClick={() => openTerminar(p)} title="Terminar lote"><CheckSquare size={16} color="#16a34a" /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {productos.length === 0 && <tr><td colSpan={9} className="empty-state">Sin productos de paquetería</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {showNew && (
        <div className="modal-overlay" onClick={() => setShowNew(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 950 }}>
            <div className="modal-header">
              <h3>Nuevo Lote de Paquetería</h3>
              <button className="btn-icon" onClick={() => setShowNew(false)}>&times;</button>
            </div>
            <form onSubmit={save}>
              <div className="form-row-3">
                <div className="form-group">
                  <label>Tipo *</label>
                  <select required value={form.tipo_producto} onChange={e => setForm({ ...form, tipo_producto: e.target.value })}>
                    <option value="carne_molida">Carne Molida</option>
                    <option value="chorizo">Chorizo</option>
                    <option value="tortas">Tortas</option>
                    <option value="hamburguesa">Hamburguesa</option>
                    <option value="otro">Otro</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Fecha *</label>
                  <input type="date" required value={form.fecha || ''} onChange={e => setForm({ ...form, fecha: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Responsable</label>
                  <input value={form.responsable || ''} onChange={e => setForm({ ...form, responsable: e.target.value })} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Peso Entrada (kg) - autocalculado</label>
                  <input type="number" step="0.001" value={form.peso_entrada_kg || totalEntrada.toFixed(3)} onChange={e => setForm({ ...form, peso_entrada_kg: parseFloat(e.target.value) || '' })} />
                </div>
                <div className="form-group">
                  <label>Aditivos (kg)</label>
                  <input type="number" step="0.001" value={form.aditivos_kg || 0} onChange={e => setForm({ ...form, aditivos_kg: parseFloat(e.target.value) || 0 })} />
                </div>
              </div>

              {/* Sección Escanear ingreso */}
              <div style={{ marginTop: 16, padding: 12, background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <ScanLine size={18} color="#1d4ed8" />
                  <strong style={{ color: '#1e3a8a' }}>Escanear ingreso (código LOT del deshuese)</strong>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr auto', gap: 8, alignItems: 'end' }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label>Temporalidad *</label>
                    <select value={scanTemporalidad} onChange={e => setScanTemporalidad(e.target.value)}>
                      <option value="fresco">Fresco</option>
                      <option value="madurado">Madurado</option>
                      <option value="congelado">Congelado</option>
                    </select>
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label>Código LOT (Enter para escanear)</label>
                    <input
                      ref={scanInputRef}
                      autoFocus
                      type="text"
                      placeholder="Escanee o digite el código LOT del deshuese..."
                      value={scanCodigo}
                      onChange={e => setScanCodigo(e.target.value)}
                      onKeyDown={onScanKey}
                      disabled={scanLoading || !!pendingScan}
                    />
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => handleScan(false)}
                    disabled={scanLoading || !!pendingScan || !scanCodigo.trim()}
                  >
                    <ScanLine size={14} /> {scanLoading ? '...' : 'Escanear'}
                  </button>
                </div>

                {scanError && (
                  <div style={{ marginTop: 8, padding: 8, background: '#fee2e2', color: '#991b1b', borderRadius: 6, fontSize: '0.85rem' }}>
                    {scanError}
                  </div>
                )}

                {pendingScan && (
                  <div style={{ marginTop: 8, padding: 10, background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                      <AlertTriangle size={18} color="#b45309" style={{ flexShrink: 0, marginTop: 2 }} />
                      <div style={{ flex: 1 }}>
                        <strong style={{ color: '#92400e' }}>Plazo excedido</strong>
                        <div style={{ fontSize: '0.85rem', color: '#92400e', marginTop: 2 }}>{pendingScan.msg}</div>
                        <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                          <button type="button" className="btn btn-primary" style={{ background: '#dc2626', borderColor: '#dc2626' }} onClick={() => handleScan(true)} disabled={scanLoading}>
                            Confirmar igual
                          </button>
                          <button type="button" className="btn btn-secondary" onClick={() => { setPendingScan(null); setScanCodigo(''); if (scanInputRef.current) scanInputRef.current.focus(); }}>
                            Cancelar
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div style={{ marginTop: 16, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong>Fuentes (BCH/Trim por animal)</strong>
                <button type="button" className="btn btn-secondary" onClick={addFuente}><Plus size={14} /> Agregar manual</button>
              </div>
              {fuentes.map((f, i) => (
                <div key={i} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 10, marginBottom: 10, background: '#fafafa' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px 110px 1fr 40px', gap: 8, alignItems: 'end' }}>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label>Animal *</label>
                      <select value={f.animal_id} onChange={e => updateFuente(i, 'animal_id', e.target.value)}>
                        <option value="">Seleccionar...</option>
                        {animales.map(a => <option key={a.id} value={a.id}>{a.numero_trazabilidad} {a.nombre || ''}</option>)}
                      </select>
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label>Origen</label>
                      <select value={f.origen} onChange={e => updateFuente(i, 'origen', e.target.value)}>
                        <option value="trim">Trim</option>
                        <option value="bch">BCH</option>
                        <option value="porcionado_trim">Trim Porcionado</option>
                        <option value="porcionado_bch">BCH Porcionado</option>
                        <option value="otro">Otro</option>
                      </select>
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label>Peso (kg) *</label>
                      <input type="number" step="0.001" value={f.peso_kg} onChange={e => updateFuente(i, 'peso_kg', e.target.value)} />
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label>Porcionado ref.</label>
                      <select value={f.porcionado_id} onChange={e => updateFuente(i, 'porcionado_id', e.target.value)}>
                        <option value="">--</option>
                        {porcionados.filter(p => !f.animal_id || p.animal_id == f.animal_id).map(p => (
                          <option key={p.id} value={p.id}>#{p.id} {p.primal_codigo}</option>
                        ))}
                      </select>
                    </div>
                    <button type="button" className="btn-icon" onClick={() => removeFuente(i)} style={{ marginBottom: 2 }}><Trash2 size={16} color="#dc2626" /></button>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr 1fr 180px 140px', gap: 8, marginTop: 8, alignItems: 'end' }}>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label>Temporalidad</label>
                      <select value={f.temporalidad || 'fresco'} onChange={e => updateFuente(i, 'temporalidad', e.target.value)}>
                        <option value="fresco">Fresco</option>
                        <option value="madurado">Madurado</option>
                        <option value="congelado">Congelado</option>
                      </select>
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label>Código BOX</label>
                      <input type="text" value={f.codigo_box || ''} onChange={e => updateFuente(i, 'codigo_box', e.target.value)} />
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label>Código LOT</label>
                      <input type="text" value={f.codigo_lot || ''} onChange={e => updateFuente(i, 'codigo_lot', e.target.value)} />
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label>Fecha ingreso</label>
                      <input type="datetime-local" value={f.fecha_ingreso || ''} onChange={e => updateFuente(i, 'fecha_ingreso', e.target.value)} />
                    </div>
                    <div style={{ marginBottom: 6 }}>
                      <label style={{ fontSize: '0.75rem', color: '#6b7280', display: 'block', marginBottom: 4 }}>
                        Días desde deshuese{f.dias_desde_deshuese !== null && f.dias_desde_deshuese !== undefined ? `: ${f.dias_desde_deshuese}` : ''}
                      </label>
                      <PlazoBadge temporalidad={f.temporalidad} dias={f.dias_desde_deshuese} />
                    </div>
                  </div>
                </div>
              ))}

              <div style={{ padding: '8px 12px', background: '#f0fdf4', borderRadius: 8, textAlign: 'center', marginBottom: 12 }}>
                <span style={{ fontSize: '0.85rem', color: '#6b7280' }}>Total fuentes: </span>
                <strong>{totalEntrada.toFixed(3)} kg</strong>
              </div>

              <div className="form-group">
                <label>Notas</label>
                <textarea rows={2} value={form.notas || ''} onChange={e => setForm({ ...form, notas: e.target.value })} />
              </div>

              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowNew(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary">Crear lote</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {terminarModal && (
        <div className="modal-overlay" onClick={() => setTerminarModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 500 }}>
            <div className="modal-header">
              <h3>Terminar lote {terminarModal.numero_lote}</h3>
              <button className="btn-icon" onClick={() => setTerminarModal(null)}>&times;</button>
            </div>
            <form onSubmit={confirmarTerminar}>
              <div className="form-group">
                <label>Peso Final Producido (kg) *</label>
                <input type="number" step="0.001" required autoFocus value={pesoFinal} onChange={e => setPesoFinal(e.target.value)} />
                <small style={{ color: '#6b7280' }}>Entrada: {parseFloat(terminarModal.peso_entrada_kg).toFixed(3)} kg + aditivos {parseFloat(terminarModal.aditivos_kg || 0).toFixed(3)} kg</small>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setTerminarModal(null)}>Cancelar</button>
                <button type="submit" className="btn btn-primary">Terminar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showView && (
        <div className="modal-overlay" onClick={() => setShowView(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 900 }}>
            <div className="modal-header">
              <h3>Lote {showView.numero_lote}</h3>
              <button className="btn-icon" onClick={() => setShowView(null)}>&times;</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div><strong>Tipo:</strong> {tipoLabel[showView.tipo_producto] || showView.tipo_producto}</div>
              <div><strong>Estado:</strong> <span className={`badge ${estadoBadge[showView.estado] || 'badge-gray'}`}>{showView.estado}</span></div>
              <div><strong>Peso entrada:</strong> {parseFloat(showView.peso_entrada_kg).toFixed(3)} kg</div>
              <div><strong>Peso final:</strong> {showView.peso_final_kg ? `${parseFloat(showView.peso_final_kg).toFixed(3)} kg` : '-'}</div>
              <div><strong>Aditivos:</strong> {parseFloat(showView.aditivos_kg || 0).toFixed(3)} kg</div>
              <div><strong>Rendimiento:</strong> {showView.rendimiento_pct ? `${parseFloat(showView.rendimiento_pct).toFixed(2)}%` : '-'}</div>
            </div>
            <h4 style={{ marginBottom: 8 }}>Fuentes (trazabilidad por animal)</h4>
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Animal</th>
                    <th>Origen</th>
                    <th>Temporalidad</th>
                    <th>Código LOT</th>
                    <th>Días</th>
                    <th>Peso aportado</th>
                    <th>Proporción</th>
                    <th>kg finales</th>
                  </tr>
                </thead>
                <tbody>
                  {(showView.fuentes || []).map(f => {
                    const finalKg = showView.peso_final_kg && f.proporcion_pct
                      ? ((parseFloat(f.proporcion_pct) / 100) * parseFloat(showView.peso_final_kg)).toFixed(3)
                      : null;
                    return (
                      <tr key={f.id}>
                        <td>{f.numero_trazabilidad}</td>
                        <td>{f.origen}</td>
                        <td>{tempLabel[f.temporalidad] || f.temporalidad || '-'}</td>
                        <td><code style={{ fontSize: '0.8rem' }}>{f.codigo_lot || '-'}</code></td>
                        <td>
                          <PlazoBadge temporalidad={f.temporalidad} dias={f.dias_desde_deshuese} />
                          {f.dias_desde_deshuese !== null && f.dias_desde_deshuese !== undefined && (
                            <div style={{ fontSize: '0.7rem', color: '#6b7280', marginTop: 2 }}>{f.dias_desde_deshuese}d</div>
                          )}
                        </td>
                        <td>{parseFloat(f.peso_kg).toFixed(3)} kg</td>
                        <td>{f.proporcion_pct ? `${parseFloat(f.proporcion_pct).toFixed(2)}%` : '-'}</td>
                        <td>{finalKg ? `${finalKg} kg` : '-'}</td>
                      </tr>
                    );
                  })}
                  {(!showView.fuentes || showView.fuentes.length === 0) && <tr><td colSpan={8} className="empty-state">Sin fuentes</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
