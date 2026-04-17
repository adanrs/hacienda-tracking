import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Edit } from 'lucide-react';
import { api } from '../services/api';
import { formatDate } from '../components/DateFormat';
import AnimalSearch from '../components/AnimalSearch';

const resultadoBadge = { aprobado: 'badge-green', rechazado: 'badge-red', pendiente: 'badge-yellow', condicional: 'badge-blue' };

function rendimientoClass(r) {
  if (r === null || r === undefined) return '';
  if (r > 50) return 'rendimiento-high';
  if (r >= 45) return 'rendimiento-mid';
  return 'rendimiento-low';
}

function calcRendimiento(pesoVivo, pesoCanalFrio) {
  if (!pesoVivo || !pesoCanalFrio || pesoVivo <= 0) return null;
  return (pesoCanalFrio / pesoVivo * 100).toFixed(2);
}

export default function Sacrificio() {
  const [sacrificios, setSacrificios] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [form, setForm] = useState({});

  const load = () => {
    api.getSacrificios().then(setSacrificios).catch(console.error);
  };

  useEffect(() => { load(); }, []);

  const openNew = () => {
    setEditItem(null);
    setForm({ resultado_inspeccion: 'pendiente' });
    setShowModal(true);
  };

  const openEdit = (s) => {
    setEditItem(s);
    setForm({ ...s });
    setShowModal(true);
  };

  const save = async (e) => {
    e.preventDefault();
    try {
      const dataToSave = { ...form };
      const rend = calcRendimiento(form.peso_vivo, form.peso_canal_frio);
      if (rend !== null) dataToSave.rendimiento_canal = parseFloat(rend);
      if (editItem) {
        await api.updateSacrificio(editItem.id, dataToSave);
      } else {
        await api.createSacrificio(dataToSave);
      }
      setShowModal(false);
      load();
    } catch (err) {
      alert(err.message);
    }
  };

  const liveRendimiento = calcRendimiento(form.peso_vivo, form.peso_canal_frio);

  return (
    <div>
      <div className="page-header">
        <h2>Sacrificio</h2>
        <button className="btn btn-primary" onClick={openNew}><Plus size={16} /> Nuevo Sacrificio</button>
      </div>

      <div className="card">
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Animal</th>
                <th>Peso Vivo</th>
                <th>Peso Canal Caliente</th>
                <th>Peso Canal Frio</th>
                <th>Rendimiento</th>
                <th>Marmoleo</th>
                <th>Inspector</th>
                <th>Resultado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {sacrificios.map(s => {
                const rend = s.rendimiento_canal || calcRendimiento(s.peso_vivo, s.peso_canal_frio);
                return (
                  <tr key={s.id}>
                    <td>{formatDate(s.fecha)}</td>
                    <td>{s.animal_id ? <Link to={`/animales/${s.animal_id}`}>{s.numero_trazabilidad || 'Ver animal'}</Link> : '-'}</td>
                    <td>{s.peso_vivo ? `${s.peso_vivo} kg` : '-'}</td>
                    <td>{s.peso_canal_caliente ? `${s.peso_canal_caliente} kg` : '-'}</td>
                    <td>{s.peso_canal_frio ? `${s.peso_canal_frio} kg` : '-'}</td>
                    <td>{rend ? <span className={rendimientoClass(parseFloat(rend))}>{rend}%</span> : '-'}</td>
                    <td>{s.marmoleo ? <span className="badge badge-blue">BMS {s.marmoleo}</span> : '-'}</td>
                    <td>{s.inspector || '-'}</td>
                    <td><span className={`badge ${resultadoBadge[s.resultado_inspeccion] || 'badge-gray'}`}>{s.resultado_inspeccion || '-'}</span></td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="btn-icon" onClick={() => openEdit(s)}><Edit size={16} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {sacrificios.length === 0 && <tr><td colSpan={10} className="empty-state">No se encontraron sacrificios</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editItem ? 'Editar Sacrificio' : 'Nuevo Sacrificio'}</h3>
              <button className="btn-icon" onClick={() => setShowModal(false)}>&times;</button>
            </div>
            <form onSubmit={save}>
              <div className="form-group">
                <label>Animal *</label>
                <AnimalSearch value={form.animal_id} onChange={id => setForm({ ...form, animal_id: id })} />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Fecha *</label>
                  <input type="datetime-local" required value={form.fecha || ''} onChange={e => setForm({ ...form, fecha: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Lote Sacrificio</label>
                  <input value={form.lote_sacrificio || ''} onChange={e => setForm({ ...form, lote_sacrificio: e.target.value })} />
                </div>
              </div>
              <div className="form-row-3">
                <div className="form-group">
                  <label>Peso Vivo (kg)</label>
                  <input type="number" step="0.1" value={form.peso_vivo || ''} onChange={e => setForm({ ...form, peso_vivo: parseFloat(e.target.value) || '' })} />
                </div>
                <div className="form-group">
                  <label>Peso Canal Caliente (kg)</label>
                  <input type="number" step="0.1" value={form.peso_canal_caliente || ''} onChange={e => setForm({ ...form, peso_canal_caliente: parseFloat(e.target.value) || '' })} />
                </div>
                <div className="form-group">
                  <label>Peso Canal Frio (kg)</label>
                  <input type="number" step="0.1" value={form.peso_canal_frio || ''} onChange={e => setForm({ ...form, peso_canal_frio: parseFloat(e.target.value) || '' })} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Marmoleo (BMS 1-12)</label>
                  <input type="number" min="1" max="12" value={form.marmoleo || ''} onChange={e => setForm({ ...form, marmoleo: parseInt(e.target.value) || '' })} placeholder="Escala BMS japonesa" />
                </div>
                <div className="form-group">
                  <label>Fecha de Colgado (canal caliente)</label>
                  <input type="datetime-local" value={form.fecha_colgado || ''} onChange={e => setForm({ ...form, fecha_colgado: e.target.value })} />
                </div>
              </div>
              {liveRendimiento !== null && (
                <div style={{ padding: '8px 12px', background: '#f0fdf4', borderRadius: 8, marginBottom: 16, textAlign: 'center' }}>
                  <span style={{ fontSize: '0.85rem', color: '#6b7280' }}>Rendimiento Canal: </span>
                  <strong className={rendimientoClass(parseFloat(liveRendimiento))}>{liveRendimiento}%</strong>
                </div>
              )}
              <div className="form-row">
                <div className="form-group">
                  <label>Inspector</label>
                  <input value={form.inspector || ''} onChange={e => setForm({ ...form, inspector: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Resultado Inspeccion</label>
                  <select value={form.resultado_inspeccion || 'pendiente'} onChange={e => setForm({ ...form, resultado_inspeccion: e.target.value })}>
                    <option value="pendiente">Pendiente</option>
                    <option value="aprobado">Aprobado</option>
                    <option value="rechazado">Rechazado</option>
                    <option value="condicional">Condicional</option>
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label>Notas</label>
                <textarea rows={2} value={form.notas || ''} onChange={e => setForm({ ...form, notas: e.target.value })} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary">{editItem ? 'Guardar' : 'Crear'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
