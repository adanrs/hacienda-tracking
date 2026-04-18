import { useState, useEffect } from 'react';
import { Plus, Trash2, CheckSquare, FileSpreadsheet } from 'lucide-react';
import { api } from '../services/api';
import { formatDate } from '../components/DateFormat';

const estadoBadge = { en_proceso: 'badge-yellow', terminado: 'badge-green', despachado: 'badge-blue' };
const tipoLabel = { carne_molida: 'Carne Molida', chorizo: 'Chorizo', tortas: 'Tortas', hamburguesa: 'Hamburguesa', otro: 'Otro' };

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

  const load = () => api.getPaqueteria().then(setProductos).catch(console.error);
  useEffect(() => {
    load();
    api.getAnimales().then(setAnimales).catch(console.error);
    api.getPorcionado().then(setPorcionados).catch(console.error);
  }, []);

  const openNew = () => {
    setForm({ fecha: new Date().toISOString().split('T')[0], tipo_producto: 'carne_molida', aditivos_kg: 0 });
    setFuentes([{ animal_id: '', origen: 'trim', peso_kg: '', porcionado_id: '' }]);
    setShowNew(true);
  };

  const addFuente = () => setFuentes([...fuentes, { animal_id: '', origen: 'trim', peso_kg: '', porcionado_id: '' }]);
  const removeFuente = (i) => setFuentes(fuentes.filter((_, idx) => idx !== i));
  const updateFuente = (i, k, v) => { const n = [...fuentes]; n[i] = { ...n[i], [k]: v }; setFuentes(n); };

  const save = async (e) => {
    e.preventDefault();
    const totalFuentes = fuentes.reduce((s, f) => s + parseFloat(f.peso_kg || 0), 0);
    if (totalFuentes <= 0) return alert('Debe ingresar al menos una fuente con peso');
    if (!form.peso_entrada_kg) form.peso_entrada_kg = totalFuentes;
    try {
      await api.createPaqueteria({ ...form, fuentes: fuentes.filter(f => f.animal_id && f.peso_kg) });
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
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 800 }}>
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

              <div style={{ marginTop: 12, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong>Fuentes (BCH/Trim por animal)</strong>
                <button type="button" className="btn btn-secondary" onClick={addFuente}><Plus size={14} /> Agregar</button>
              </div>
              {fuentes.map((f, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 140px 130px 1fr 40px', gap: 8, marginBottom: 8, alignItems: 'end' }}>
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
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 750 }}>
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
                <thead><tr><th>Animal</th><th>Origen</th><th>Peso aportado</th><th>Proporción</th><th>kg finales asignados</th></tr></thead>
                <tbody>
                  {(showView.fuentes || []).map(f => {
                    const finalKg = showView.peso_final_kg && f.proporcion_pct
                      ? ((parseFloat(f.proporcion_pct) / 100) * parseFloat(showView.peso_final_kg)).toFixed(3)
                      : null;
                    return (
                      <tr key={f.id}>
                        <td>{f.numero_trazabilidad}</td>
                        <td>{f.origen}</td>
                        <td>{parseFloat(f.peso_kg).toFixed(3)} kg</td>
                        <td>{f.proporcion_pct ? `${parseFloat(f.proporcion_pct).toFixed(2)}%` : '-'}</td>
                        <td>{finalKg ? `${finalKg} kg` : '-'}</td>
                      </tr>
                    );
                  })}
                  {(!showView.fuentes || showView.fuentes.length === 0) && <tr><td colSpan={5} className="empty-state">Sin fuentes</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
