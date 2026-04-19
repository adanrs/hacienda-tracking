import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Edit, Trash2, Upload, FileText } from 'lucide-react';
import { api } from '../services/api';
import { formatDate } from '../components/DateFormat';

const estadoBadge = { abierto: 'badge-yellow', cerrado: 'badge-green', reabierto: 'badge-blue' };
const primalTipos = ['Lomo', 'Costilla', 'Pierna', 'Paleta', 'Pecho', 'Falda', 'Aguja', 'BCH', 'Otro'];

export default function Deshuese() {
  const [items, setItems] = useState([]);
  const [sacrificios, setSacrificios] = useState([]);
  const [bodegas, setBodegas] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [form, setForm] = useState({});
  const [primalesList, setPrimalesList] = useState([]);
  const [prorrateo, setProrrateo] = useState(false);
  const fileInputRef = useRef();
  const [uploadId, setUploadId] = useState(null);

  const load = () => api.getDeshuese().then(setItems).catch(console.error);

  useEffect(() => {
    load();
    api.getSacrificios().then(setSacrificios).catch(console.error);
    api.getBodegas().then(setBodegas).catch(console.error);
  }, []);

  const bodegasDeshuese = bodegas.filter(b => b.tipo === 'deshuese');

  const openNew = () => {
    setEditItem(null);
    setForm({ estado: 'abierto' });
    setPrimalesList([{ tipo_primal: 'Lomo', peso_kg: '', marmoleo: '' }]);
    setProrrateo(false);
    setShowModal(true);
  };

  const openEdit = (d) => {
    setEditItem(d);
    setForm({ ...d });
    setPrimalesList([]);
    setProrrateo(false);
    setShowModal(true);
  };

  const addPrimalRow = () => setPrimalesList([...primalesList, { tipo_primal: 'Lomo', peso_kg: '', marmoleo: '' }]);
  const removePrimalRow = (i) => setPrimalesList(primalesList.filter((_, idx) => idx !== i));
  const updatePrimalRow = (i, key, val) => {
    const next = [...primalesList];
    next[i] = { ...next[i], [key]: val };
    setPrimalesList(next);
  };

  const save = async (e) => {
    e.preventDefault();
    try {
      const payload = { ...form, primales: primalesList.filter(p => p.peso_kg), prorrateo };
      if (editItem) await api.updateDeshuese(editItem.id, payload);
      else await api.createDeshuese(payload);
      setShowModal(false);
      load();
    } catch (err) { alert(err.message); }
  };

  const remove = async (id) => {
    if (!confirm('Eliminar este deshuese?')) return;
    try { await api.deleteDeshuese(id); load(); } catch (err) { alert(err.message); }
  };

  const triggerUpload = (id) => {
    setUploadId(id);
    fileInputRef.current.value = '';
    fileInputRef.current.click();
  };

  const onFilePicked = async (e) => {
    const file = e.target.files[0];
    if (!file || !uploadId) return;
    try {
      await api.uploadDeshuesePdf(uploadId, file);
      load();
    } catch (err) { alert(err.message); }
  };

  return (
    <div>
      <div className="page-header">
        <h2>Deshuese</h2>
        <button className="btn btn-primary" onClick={openNew}><Plus size={16} /> Nuevo Deshuese</button>
      </div>

      <input type="file" ref={fileInputRef} accept="application/pdf" style={{ display: 'none' }} onChange={onFilePicked} />

      <div className="card">
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Numero Lote</th>
                <th>Fecha</th>
                <th>Animal</th>
                <th>Sacrificio</th>
                <th>Peso Entrada</th>
                <th>Estado</th>
                <th>Responsable</th>
                <th>PDF</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {items.map(d => (
                <tr key={d.id}>
                  <td>{d.numero_lote || `#${d.id}`}</td>
                  <td>{formatDate(d.fecha)}</td>
                  <td>{d.animal_id ? <Link to={`/animales/${d.animal_id}`}>{d.numero_trazabilidad || 'Ver'}</Link> : '-'}</td>
                  <td>{d.lote_sacrificio || '-'}</td>
                  <td>{d.peso_entrada ? `${parseFloat(d.peso_entrada).toFixed(2)} kg` : '-'}</td>
                  <td><span className={`badge ${estadoBadge[d.estado] || 'badge-gray'}`}>{d.estado || '-'}</span></td>
                  <td>{d.responsable || '-'}</td>
                  <td>{d.pdf_url ? <a href={d.pdf_url} target="_blank" rel="noreferrer"><FileText size={18} /></a> : '-'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn-icon" onClick={() => openEdit(d)}><Edit size={16} /></button>
                      <button className="btn-icon" onClick={() => triggerUpload(d.id)}><Upload size={16} /></button>
                      <button className="btn-icon" onClick={() => remove(d.id)}><Trash2 size={16} color="#dc2626" /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {items.length === 0 && <tr><td colSpan={9} className="empty-state">No hay registros de deshuese</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 800 }}>
            <div className="modal-header">
              <h3>{editItem ? 'Editar Deshuese' : 'Nuevo Deshuese'}</h3>
              <button className="btn-icon" onClick={() => setShowModal(false)}>&times;</button>
            </div>
            <form onSubmit={save}>
              <div className="form-group">
                <label>Sacrificio *</label>
                <select required value={form.sacrificio_id || ''} onChange={e => {
                  const s = sacrificios.find(x => String(x.id) === String(e.target.value));
                  setForm({ ...form, sacrificio_id: e.target.value, animal_id: s?.animal_id || null });
                }}>
                  <option value="">Seleccionar...</option>
                  {sacrificios.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.lote_sacrificio || `Sacrificio #${s.id}`} - {s.numero_trazabilidad || 'Animal'} ({formatDate(s.fecha)})
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-row-3">
                <div className="form-group">
                  <label>Fecha *</label>
                  <input type="datetime-local" required value={form.fecha || ''} onChange={e => setForm({ ...form, fecha: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Peso Entrada (kg)</label>
                  <input type="number" step="0.01" value={form.peso_entrada || ''} onChange={e => setForm({ ...form, peso_entrada: parseFloat(e.target.value) || '' })} />
                </div>
                <div className="form-group">
                  <label>Responsable</label>
                  <input value={form.responsable || ''} onChange={e => setForm({ ...form, responsable: e.target.value })} />
                </div>
              </div>
              <div className="form-group">
                <label>Bodega Origen</label>
                <select value={form.bodega_origen_id || ''} onChange={e => setForm({ ...form, bodega_origen_id: e.target.value })}>
                  <option value="">Seleccionar...</option>
                  {bodegasDeshuese.map(b => <option key={b.id} value={b.id}>{b.codigo} - {b.nombre}</option>)}
                </select>
              </div>

              {!editItem && (
                <>
                  <div style={{ marginTop: 12, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong>Primales</strong>
                    <button type="button" className="btn btn-secondary" onClick={addPrimalRow}><Plus size={14} /> Agregar</button>
                  </div>
                  {primalesList.map((p, i) => (
                    <div key={i} className="form-row-3" style={{ alignItems: 'end' }}>
                      <div className="form-group">
                        <label>Tipo</label>
                        <select value={p.tipo_primal} onChange={e => updatePrimalRow(i, 'tipo_primal', e.target.value)}>
                          {primalTipos.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>
                      <div className="form-group">
                        <label>Peso (kg)</label>
                        <input type="number" step="0.01" value={p.peso_kg} onChange={e => updatePrimalRow(i, 'peso_kg', parseFloat(e.target.value) || '')} />
                      </div>
                      <div className="form-group" style={{ display: 'flex', gap: 6 }}>
                        <div style={{ flex: 1 }}>
                          <label>Marmoleo</label>
                          <input type="number" min="1" max="12" value={p.marmoleo} onChange={e => updatePrimalRow(i, 'marmoleo', parseInt(e.target.value) || '')} />
                        </div>
                        <button type="button" className="btn-icon" onClick={() => removePrimalRow(i)} style={{ marginBottom: 2 }}><Trash2 size={16} color="#dc2626" /></button>
                      </div>
                    </div>
                  ))}
                  <div className="form-group" style={{ marginTop: 8 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input type="checkbox" checked={prorrateo} onChange={e => setProrrateo(e.target.checked)} />
                      Prorratear pesos
                    </label>
                  </div>
                </>
              )}

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
