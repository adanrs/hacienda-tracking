import { useState, useEffect } from 'react';
import { Plus, Edit, Trash2, MapPin } from 'lucide-react';
import { api } from '../services/api';

const estadoBadge = { activo: 'badge-green', inactivo: 'badge-gray', mantenimiento: 'badge-yellow' };

export default function Potreros() {
  const [potreros, setPotreros] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editPotrero, setEditPotrero] = useState(null);
  const [form, setForm] = useState({ estado: 'activo' });

  const load = () => api.getPotreros().then(setPotreros).catch(console.error);
  useEffect(() => { load(); }, []);

  const openNew = () => { setEditPotrero(null); setForm({ estado: 'activo' }); setShowModal(true); };
  const openEdit = (p) => { setEditPotrero(p); setForm({ ...p }); setShowModal(true); };

  const save = async (e) => {
    e.preventDefault();
    try {
      if (editPotrero) {
        await api.updatePotrero(editPotrero.id, form);
      } else {
        await api.createPotrero(form);
      }
      setShowModal(false);
      load();
    } catch (err) { alert(err.message); }
  };

  const remove = async (id) => {
    if (!confirm('Eliminar este potrero?')) return;
    await api.deletePotrero(id);
    load();
  };

  return (
    <div>
      <div className="page-header">
        <h2>Potreros</h2>
        <button className="btn btn-primary" onClick={openNew}><Plus size={16} /> Nuevo Potrero</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
        {potreros.map(p => (
          <div className="card" key={p.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 12 }}>
              <div>
                <h3 style={{ fontSize: '1.1rem' }}><MapPin size={16} style={{ marginRight: 4 }} />{p.nombre}</h3>
                <span className={`badge ${estadoBadge[p.estado]}`}>{p.estado}</span>
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <button className="btn-icon" onClick={() => openEdit(p)}><Edit size={16} /></button>
                <button className="btn-icon" onClick={() => remove(p.id)}><Trash2 size={16} color="#dc2626" /></button>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, textAlign: 'center' }}>
              <div>
                <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#16a34a' }}>{p.total_animales}</div>
                <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>Animales</div>
              </div>
              <div>
                <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{p.superficie_ha || '-'}</div>
                <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>Hectareas</div>
              </div>
              <div>
                <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{p.capacidad_animales || '-'}</div>
                <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>Capacidad</div>
              </div>
            </div>
            {p.capacidad_animales > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#6b7280', marginBottom: 4 }}>
                  <span>Ocupacion</span>
                  <span>{Math.round((p.total_animales / p.capacidad_animales) * 100)}%</span>
                </div>
                <div style={{ height: 6, background: '#e5e7eb', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.min(100, (p.total_animales / p.capacidad_animales) * 100)}%`, background: p.total_animales > p.capacidad_animales ? '#dc2626' : '#16a34a', borderRadius: 3 }} />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h3>{editPotrero ? 'Editar Potrero' : 'Nuevo Potrero'}</h3><button className="btn-icon" onClick={() => setShowModal(false)}>&times;</button></div>
            <form onSubmit={save}>
              <div className="form-group">
                <label>Nombre *</label>
                <input required value={form.nombre || ''} onChange={e => setForm({ ...form, nombre: e.target.value })} />
              </div>
              <div className="form-row-3">
                <div className="form-group">
                  <label>Superficie (ha)</label>
                  <input type="number" step="0.1" value={form.superficie_ha || ''} onChange={e => setForm({ ...form, superficie_ha: parseFloat(e.target.value) })} />
                </div>
                <div className="form-group">
                  <label>Capacidad</label>
                  <input type="number" value={form.capacidad_animales || ''} onChange={e => setForm({ ...form, capacidad_animales: parseInt(e.target.value) })} />
                </div>
                <div className="form-group">
                  <label>Estado</label>
                  <select value={form.estado} onChange={e => setForm({ ...form, estado: e.target.value })}>
                    <option value="activo">Activo</option>
                    <option value="inactivo">Inactivo</option>
                    <option value="mantenimiento">Mantenimiento</option>
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label>Ubicacion GPS</label>
                <input value={form.ubicacion_gps || ''} onChange={e => setForm({ ...form, ubicacion_gps: e.target.value })} placeholder="lat, lng" />
              </div>
              <div className="form-group">
                <label>Notas</label>
                <textarea rows={2} value={form.notas || ''} onChange={e => setForm({ ...form, notas: e.target.value })} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary">{editPotrero ? 'Guardar' : 'Crear'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
