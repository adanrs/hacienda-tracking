import { useState, useEffect } from 'react';
import { Plus, Trash2, AlertTriangle } from 'lucide-react';
import { api } from '../services/api';
import { Link } from 'react-router-dom';

const tipoBadge = { vacunacion: 'badge-green', desparasitacion: 'badge-blue', tratamiento: 'badge-yellow', cirugia: 'badge-red', examen: 'badge-gray', otro: 'badge-gray' };

export default function Salud() {
  const [eventos, setEventos] = useState([]);
  const [alertas, setAlertas] = useState([]);
  const [animales, setAnimales] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ tipo: 'vacunacion' });
  const [tab, setTab] = useState('todos');

  const load = () => {
    api.getEventosSalud().then(setEventos).catch(console.error);
    api.getAlertasSalud(60).then(setAlertas).catch(console.error);
  };

  useEffect(() => { load(); api.getAnimales({ estado: 'activo' }).then(setAnimales); }, []);

  const save = async (e) => {
    e.preventDefault();
    try {
      await api.createEventoSalud(form);
      setShowModal(false);
      setForm({ tipo: 'vacunacion' });
      load();
    } catch (err) { alert(err.message); }
  };

  const remove = async (id) => {
    if (!confirm('Eliminar este evento?')) return;
    await api.deleteEventoSalud(id);
    load();
  };

  const items = tab === 'alertas' ? alertas : eventos;

  return (
    <div>
      <div className="page-header">
        <h2>Salud Animal</h2>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={16} /> Nuevo Evento</button>
      </div>

      <div className="tabs">
        <div className={`tab ${tab === 'todos' ? 'active' : ''}`} onClick={() => setTab('todos')}>Todos ({eventos.length})</div>
        <div className={`tab ${tab === 'alertas' ? 'active' : ''}`} onClick={() => setTab('alertas')}><AlertTriangle size={14} style={{ marginRight: 4 }} />Proximos ({alertas.length})</div>
      </div>

      <div className="card">
        <div className="table-container">
          <table>
            <thead><tr><th>Fecha</th><th>Animal</th><th>Tipo</th><th>Descripcion</th><th>Producto</th><th>Veterinario</th><th>Proxima</th><th></th></tr></thead>
            <tbody>
              {items.map(e => (
                <tr key={e.id}>
                  <td>{e.fecha}</td>
                  <td><Link to={`/animales/${e.animal_id}`}>{e.numero_trazabilidad}</Link></td>
                  <td><span className={`badge ${tipoBadge[e.tipo]}`}>{e.tipo}</span></td>
                  <td>{e.descripcion}</td>
                  <td>{e.producto || '-'}</td>
                  <td>{e.veterinario || '-'}</td>
                  <td>{e.proxima_fecha || '-'}</td>
                  <td><button className="btn-icon" onClick={() => remove(e.id)}><Trash2 size={16} color="#dc2626" /></button></td>
                </tr>
              ))}
              {items.length === 0 && <tr><td colSpan={8} className="empty-state">Sin eventos</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h3>Nuevo Evento de Salud</h3><button className="btn-icon" onClick={() => setShowModal(false)}>&times;</button></div>
            <form onSubmit={save}>
              <div className="form-row">
                <div className="form-group">
                  <label>Animal *</label>
                  <select required value={form.animal_id || ''} onChange={e => setForm({ ...form, animal_id: parseInt(e.target.value) })}>
                    <option value="">Seleccionar...</option>
                    {animales.map(a => <option key={a.id} value={a.id}>{a.numero_trazabilidad} - {a.nombre || a.raza}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Tipo *</label>
                  <select required value={form.tipo} onChange={e => setForm({ ...form, tipo: e.target.value })}>
                    <option value="vacunacion">Vacunacion</option>
                    <option value="desparasitacion">Desparasitacion</option>
                    <option value="tratamiento">Tratamiento</option>
                    <option value="cirugia">Cirugia</option>
                    <option value="examen">Examen</option>
                    <option value="otro">Otro</option>
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Fecha *</label>
                  <input type="date" required value={form.fecha || ''} onChange={e => setForm({ ...form, fecha: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Proxima Fecha</label>
                  <input type="date" value={form.proxima_fecha || ''} onChange={e => setForm({ ...form, proxima_fecha: e.target.value })} />
                </div>
              </div>
              <div className="form-group">
                <label>Descripcion *</label>
                <textarea rows={2} required value={form.descripcion || ''} onChange={e => setForm({ ...form, descripcion: e.target.value })} />
              </div>
              <div className="form-row-3">
                <div className="form-group">
                  <label>Producto</label>
                  <input value={form.producto || ''} onChange={e => setForm({ ...form, producto: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Dosis</label>
                  <input value={form.dosis || ''} onChange={e => setForm({ ...form, dosis: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Veterinario</label>
                  <input value={form.veterinario || ''} onChange={e => setForm({ ...form, veterinario: e.target.value })} />
                </div>
              </div>
              <div className="form-group">
                <label>Costo</label>
                <input type="number" step="0.01" value={form.costo || ''} onChange={e => setForm({ ...form, costo: parseFloat(e.target.value) })} />
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
