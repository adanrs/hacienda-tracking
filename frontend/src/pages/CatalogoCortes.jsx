import { useState, useEffect } from 'react';
import { Plus, Edit, Trash2, Scissors } from 'lucide-react';
import { api } from '../services/api';

const tipoBadge = {
  primal: 'badge-blue',
  retail: 'badge-green',
  subproducto: 'badge-yellow',
  grasa: 'badge-gray',
  trim: 'badge-gray',
  bch: 'badge-blue',
  otro: 'badge-gray',
};
const tipos = ['primal', 'retail', 'subproducto', 'grasa', 'trim', 'bch', 'otro'];

export default function CatalogoCortes() {
  const [cortes, setCortes] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [form, setForm] = useState({});

  const load = () => api.getCatalogoCortes().then(setCortes).catch(console.error);
  useEffect(() => { load(); }, []);

  const openNew = () => {
    setEditItem(null);
    setForm({ tipo: 'primal', vida_util_dias: 90, vida_congelado_dias: 365, activo: 1 });
    setShowModal(true);
  };
  const openEdit = (c) => { setEditItem(c); setForm({ ...c }); setShowModal(true); };

  const save = async (e) => {
    e.preventDefault();
    try {
      if (editItem) await api.updateCatalogoCorte(editItem.id, form);
      else await api.createCatalogoCorte(form);
      setShowModal(false);
      load();
    } catch (err) { alert(err.message); }
  };

  const remove = async (id) => {
    if (!confirm('Desactivar este corte del catalogo?')) return;
    try { await api.deleteCatalogoCorte(id); load(); } catch (err) { alert(err.message); }
  };

  return (
    <div>
      <div className="page-header">
        <h2>Catalogo de Cortes</h2>
        <button className="btn btn-primary" onClick={openNew}><Plus size={16} /> Nuevo Corte</button>
      </div>

      <div className="card">
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Codigo</th>
                <th>Nombre</th>
                <th>Abreviatura</th>
                <th>Tipo</th>
                <th>Vida util (dias)</th>
                <th>Vida congelado (dias)</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {cortes.map(c => (
                <tr key={c.id}>
                  <td><strong>{c.codigo}</strong></td>
                  <td><Scissors size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />{c.nombre}</td>
                  <td>{c.abreviatura || '-'}</td>
                  <td><span className={`badge ${tipoBadge[c.tipo] || 'badge-gray'}`}>{c.tipo}</span></td>
                  <td>{c.vida_util_dias ?? '-'}</td>
                  <td>{c.vida_congelado_dias ?? '-'}</td>
                  <td><span className={`badge ${c.activo ? 'badge-green' : 'badge-gray'}`}>{c.activo ? 'Activo' : 'Inactivo'}</span></td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn-icon" onClick={() => openEdit(c)}><Edit size={16} /></button>
                      <button className="btn-icon" onClick={() => remove(c.id)}><Trash2 size={16} color="#dc2626" /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {cortes.length === 0 && <tr><td colSpan={8} className="empty-state">No hay cortes registrados en el catalogo</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editItem ? 'Editar Corte' : 'Nuevo Corte'}</h3>
              <button className="btn-icon" onClick={() => setShowModal(false)}>&times;</button>
            </div>
            <form onSubmit={save}>
              <div className="form-row">
                <div className="form-group">
                  <label>Codigo *</label>
                  <input required value={form.codigo || ''} onChange={e => setForm({ ...form, codigo: e.target.value })} placeholder="ej: 21231" />
                </div>
                <div className="form-group">
                  <label>Nombre *</label>
                  <input required value={form.nombre || ''} onChange={e => setForm({ ...form, nombre: e.target.value })} placeholder="ej: DELMONICO" />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Abreviatura</label>
                  <input maxLength={50} value={form.abreviatura || ''} onChange={e => setForm({ ...form, abreviatura: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Tipo *</label>
                  <select value={form.tipo || 'primal'} onChange={e => setForm({ ...form, tipo: e.target.value })}>
                    {tipos.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Vida util (dias)</label>
                  <input type="number" min="0" value={form.vida_util_dias ?? ''} onChange={e => setForm({ ...form, vida_util_dias: parseInt(e.target.value) || 0 })} placeholder="90" />
                </div>
                <div className="form-group">
                  <label>Vida congelado (dias)</label>
                  <input type="number" min="0" value={form.vida_congelado_dias ?? ''} onChange={e => setForm({ ...form, vida_congelado_dias: parseInt(e.target.value) || 0 })} placeholder="365" />
                </div>
              </div>
              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input type="checkbox" checked={!!form.activo} onChange={e => setForm({ ...form, activo: e.target.checked ? 1 : 0 })} />
                  Activo
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
