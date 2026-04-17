import { useState, useEffect } from 'react';
import { Plus, Edit, Trash2, Snowflake } from 'lucide-react';
import { api } from '../services/api';

const tipoBadge = { custodia: 'badge-blue', maduracion: 'badge-yellow', deshuese: 'badge-gray', porcionado: 'badge-green', almacen: 'badge-gray' };
const tipos = ['custodia', 'maduracion', 'deshuese', 'porcionado', 'almacen'];

export default function Bodegas() {
  const [bodegas, setBodegas] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [form, setForm] = useState({});

  const load = () => api.getBodegas().then(setBodegas).catch(console.error);
  useEffect(() => { load(); }, []);

  const openNew = () => { setEditItem(null); setForm({ tipo: 'custodia', activa: 1 }); setShowModal(true); };
  const openEdit = (b) => { setEditItem(b); setForm({ ...b }); setShowModal(true); };

  const save = async (e) => {
    e.preventDefault();
    try {
      if (editItem) await api.updateBodega(editItem.id, form);
      else await api.createBodega(form);
      setShowModal(false);
      load();
    } catch (err) { alert(err.message); }
  };

  const remove = async (id) => {
    if (!confirm('Eliminar esta bodega?')) return;
    try { await api.deleteBodega(id); load(); } catch (err) { alert(err.message); }
  };

  return (
    <div>
      <div className="page-header">
        <h2>Bodegas</h2>
        <button className="btn btn-primary" onClick={openNew}><Plus size={16} /> Nueva Bodega</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
        {bodegas.map(b => (
          <div className="card" key={b.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 12 }}>
              <div>
                <h3 style={{ fontSize: '1.05rem' }}><Snowflake size={16} style={{ marginRight: 4 }} />{b.codigo}</h3>
                <div style={{ fontSize: '0.85rem', color: '#6b7280' }}>{b.nombre}</div>
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <button className="btn-icon" onClick={() => openEdit(b)}><Edit size={16} /></button>
                <button className="btn-icon" onClick={() => remove(b.id)}><Trash2 size={16} color="#dc2626" /></button>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
              <span className={`badge ${tipoBadge[b.tipo] || 'badge-gray'}`}>{b.tipo}</span>
              <span className={`badge ${b.activa ? 'badge-green' : 'badge-gray'}`}>{b.activa ? 'Activa' : 'Inactiva'}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, textAlign: 'center' }}>
              <div>
                <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#2563eb' }}>{b.temperatura_c !== null && b.temperatura_c !== undefined ? `${parseFloat(b.temperatura_c).toFixed(1)}°C` : '-'}</div>
                <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>Temperatura</div>
              </div>
              <div>
                <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{b.capacidad_kg ? `${parseFloat(b.capacidad_kg).toFixed(0)}kg` : '-'}</div>
                <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>Capacidad</div>
              </div>
            </div>
            {b.notas && <div style={{ marginTop: 8, fontSize: '0.8rem', color: '#6b7280' }}>{b.notas}</div>}
          </div>
        ))}
        {bodegas.length === 0 && <div className="empty-state">No hay bodegas registradas</div>}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editItem ? 'Editar Bodega' : 'Nueva Bodega'}</h3>
              <button className="btn-icon" onClick={() => setShowModal(false)}>&times;</button>
            </div>
            <form onSubmit={save}>
              <div className="form-row">
                <div className="form-group">
                  <label>Codigo *</label>
                  <input required value={form.codigo || ''} onChange={e => setForm({ ...form, codigo: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Nombre *</label>
                  <input required value={form.nombre || ''} onChange={e => setForm({ ...form, nombre: e.target.value })} />
                </div>
              </div>
              <div className="form-row-3">
                <div className="form-group">
                  <label>Tipo *</label>
                  <select value={form.tipo || 'custodia'} onChange={e => setForm({ ...form, tipo: e.target.value })}>
                    {tipos.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Temperatura (°C)</label>
                  <input type="number" step="0.1" value={form.temperatura_c ?? ''} onChange={e => setForm({ ...form, temperatura_c: parseFloat(e.target.value) })} />
                </div>
                <div className="form-group">
                  <label>Capacidad (kg)</label>
                  <input type="number" step="0.1" value={form.capacidad_kg ?? ''} onChange={e => setForm({ ...form, capacidad_kg: parseFloat(e.target.value) })} />
                </div>
              </div>
              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input type="checkbox" checked={!!form.activa} onChange={e => setForm({ ...form, activa: e.target.checked ? 1 : 0 })} />
                  Activa
                </label>
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
