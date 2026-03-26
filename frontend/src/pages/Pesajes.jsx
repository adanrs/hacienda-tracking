import { useState, useEffect } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../services/api';
import { Link } from 'react-router-dom';
import AnimalSearch from '../components/AnimalSearch';
import { formatDate } from '../components/DateFormat';

export default function Pesajes() {
  const [pesajes, setPesajes] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ tipo: 'rutinario' });

  const load = () => api.getPesajes().then(setPesajes).catch(console.error);
  useEffect(() => { load(); }, []);

  const save = async (e) => {
    e.preventDefault();
    if (!form.animal_id) { alert('Selecciona un animal'); return; }
    try {
      await api.createPesaje(form);
      setShowModal(false);
      setForm({ tipo: 'rutinario' });
      load();
    } catch (err) { alert(err.message); }
  };

  const remove = async (id) => {
    if (!confirm('Eliminar este pesaje?')) return;
    await api.deletePesaje(id);
    load();
  };

  return (
    <div>
      <div className="page-header">
        <h2>Pesajes</h2>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={16} /> Nuevo Pesaje</button>
      </div>
      <div className="card">
        <div className="table-container">
          <table>
            <thead><tr><th>Fecha</th><th>Animal</th><th>Peso (kg)</th><th>Tipo</th><th>Notas</th><th></th></tr></thead>
            <tbody>
              {pesajes.map(p => (
                <tr key={p.id}>
                  <td>{formatDate(p.fecha)}</td>
                  <td><Link to={`/animales/${p.animal_id}`}>{p.numero_trazabilidad} {p.animal_nombre && `(${p.animal_nombre})`}</Link></td>
                  <td><strong>{p.peso_kg} kg</strong></td>
                  <td><span className="badge badge-green">{p.tipo}</span></td>
                  <td>{p.notas || '-'}</td>
                  <td><button className="btn-icon" onClick={() => remove(p.id)}><Trash2 size={16} color="#dc2626" /></button></td>
                </tr>
              ))}
              {pesajes.length === 0 && <tr><td colSpan={6} className="empty-state">Sin pesajes registrados</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h3>Nuevo Pesaje</h3><button className="btn-icon" onClick={() => setShowModal(false)}>&times;</button></div>
            <form onSubmit={save}>
              <div className="form-group">
                <label>Animal *</label>
                <AnimalSearch value={form.animal_id} onChange={id => setForm({ ...form, animal_id: id })} />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Peso (kg) *</label>
                  <input type="number" step="0.1" required value={form.peso_kg || ''} onChange={e => setForm({ ...form, peso_kg: parseFloat(e.target.value) })} placeholder="Ej: 350.5" style={{ fontSize: '1.2rem', fontWeight: 700, textAlign: 'center' }} />
                </div>
                <div className="form-group">
                  <label>Fecha *</label>
                  <input type="date" required value={form.fecha || ''} onChange={e => setForm({ ...form, fecha: e.target.value })} />
                </div>
              </div>
              <div className="form-group">
                <label>Tipo</label>
                <select value={form.tipo} onChange={e => setForm({ ...form, tipo: e.target.value })}>
                  <option value="rutinario">Rutinario</option>
                  <option value="nacimiento">Nacimiento</option>
                  <option value="destete">Destete</option>
                  <option value="venta">Venta</option>
                  <option value="entrada">Entrada</option>
                </select>
              </div>
              <div className="form-group">
                <label>Notas</label>
                <textarea rows={2} value={form.notas || ''} onChange={e => setForm({ ...form, notas: e.target.value })} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary">Registrar</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
