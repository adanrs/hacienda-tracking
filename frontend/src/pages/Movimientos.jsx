import { useState, useEffect } from 'react';
import { Plus } from 'lucide-react';
import { api } from '../services/api';
import { Link } from 'react-router-dom';
import AnimalSearch from '../components/AnimalSearch';
import { formatDate } from '../components/DateFormat';

export default function Movimientos() {
  const [movimientos, setMovimientos] = useState([]);
  const [potreros, setPotreros] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({});

  const load = () => api.getMovimientos().then(setMovimientos).catch(console.error);
  useEffect(() => {
    load();
    api.getPotreros().then(setPotreros);
  }, []);

  const save = async (e) => {
    e.preventDefault();
    if (!form.animal_id) { alert('Selecciona un animal'); return; }
    try {
      await api.createMovimiento(form);
      setShowModal(false);
      setForm({});
      load();
    } catch (err) { alert(err.message); }
  };

  return (
    <div>
      <div className="page-header">
        <h2>Movimientos</h2>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={16} /> Nuevo Movimiento</button>
      </div>
      <div className="card">
        <div className="table-container">
          <table>
            <thead><tr><th>Fecha</th><th>Animal</th><th>Origen</th><th>Destino</th><th>Motivo</th><th>Responsable</th></tr></thead>
            <tbody>
              {movimientos.map(m => (
                <tr key={m.id}>
                  <td>{formatDate(m.fecha)}</td>
                  <td><Link to={`/animales/${m.animal_id}`}>{m.numero_trazabilidad} {m.animal_nombre && `(${m.animal_nombre})`}</Link></td>
                  <td>{m.origen_nombre || '-'}</td>
                  <td>{m.destino_nombre || '-'}</td>
                  <td>{m.motivo || '-'}</td>
                  <td>{m.responsable || '-'}</td>
                </tr>
              ))}
              {movimientos.length === 0 && <tr><td colSpan={6} className="empty-state">Sin movimientos registrados</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h3>Nuevo Movimiento</h3><button className="btn-icon" onClick={() => setShowModal(false)}>&times;</button></div>
            <form onSubmit={save}>
              <div className="form-group">
                <label>Animal *</label>
                <AnimalSearch value={form.animal_id} onChange={id => setForm({ ...form, animal_id: id })} />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Potrero Origen</label>
                  <select value={form.potrero_origen_id || ''} onChange={e => setForm({ ...form, potrero_origen_id: parseInt(e.target.value) || null })}>
                    <option value="">Seleccionar...</option>
                    {potreros.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Potrero Destino</label>
                  <select value={form.potrero_destino_id || ''} onChange={e => setForm({ ...form, potrero_destino_id: parseInt(e.target.value) || null })}>
                    <option value="">Seleccionar...</option>
                    {potreros.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Fecha *</label>
                  <input type="date" required value={form.fecha || ''} onChange={e => setForm({ ...form, fecha: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Responsable</label>
                  <input value={form.responsable || ''} onChange={e => setForm({ ...form, responsable: e.target.value })} />
                </div>
              </div>
              <div className="form-group">
                <label>Motivo</label>
                <textarea rows={2} value={form.motivo || ''} onChange={e => setForm({ ...form, motivo: e.target.value })} />
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
