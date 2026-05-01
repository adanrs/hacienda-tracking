import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Edit, Truck } from 'lucide-react';
import { api } from '../services/api';
import { formatDate } from '../components/DateFormat';
import AnimalSearch from '../components/AnimalSearch';

const estadoBadge = { programado: 'badge-blue', en_transito: 'badge-yellow', recibido: 'badge-green', cancelado: 'badge-red' };

export default function Transporte() {
  const [transportes, setTransportes] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [form, setForm] = useState({});

  const load = () => {
    api.getTransportes().then(setTransportes).catch(console.error);
  };

  useEffect(() => { load(); }, []);

  const openNew = () => {
    setEditItem(null);
    setForm({ tipo: 'interno', estado: 'programado' });
    setShowModal(true);
  };

  const openEdit = (t) => {
    setEditItem(t);
    setForm({ ...t });
    setShowModal(true);
  };

  const save = async (e) => {
    e.preventDefault();
    try {
      if (editItem) {
        await api.updateTransporte(editItem.id, form);
      } else {
        await api.createTransporte(form);
      }
      setShowModal(false);
      load();
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h2>Transporte</h2>
        <button className="btn btn-primary" onClick={openNew}><Plus size={16} /> Nuevo Transporte</button>
      </div>

      <div className="card">
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Fecha Salida</th>
                <th>Animal</th>
                <th>Tipo</th>
                <th>Destino</th>
                <th>Transportista</th>
                <th>Pasaje</th>
                <th>Placa</th>
                <th>Guia</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {transportes.map(t => (
                <tr key={t.id}>
                  <td>{formatDate(t.fecha_salida)}</td>
                  <td>{t.animal_id ? <Link to={`/animales/${t.animal_id}`}>{t.numero_trazabilidad || 'Ver animal'}</Link> : '-'}</td>
                  <td>{t.tipo || '-'}</td>
                  <td>{t.destino || '-'}</td>
                  <td>{t.transportista || '-'}</td>
                  <td>{t.tipo_pasaje || '-'}</td>
                  <td>{t.placa_vehiculo || '-'}</td>
                  <td>{t.guia_movilizacion || '-'}</td>
                  <td><span className={`badge ${estadoBadge[t.estado] || 'badge-gray'}`}>{t.estado}</span></td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn-icon" onClick={() => openEdit(t)}><Edit size={16} /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {transportes.length === 0 && <tr><td colSpan={10} className="empty-state">No se encontraron transportes</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editItem ? 'Editar Transporte' : 'Nuevo Transporte'}</h3>
              <button className="btn-icon" onClick={() => setShowModal(false)}>&times;</button>
            </div>
            <form onSubmit={save}>
              <div className="form-group">
                <label>Animal *</label>
                <AnimalSearch value={form.animal_id} onChange={id => setForm({ ...form, animal_id: id })} />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Tipo *</label>
                  <select required value={form.tipo || 'interno'} onChange={e => setForm({ ...form, tipo: e.target.value })}>
                    <option value="interno">Interno</option>
                    <option value="compra">Compra</option>
                    <option value="venta">Venta</option>
                    <option value="feria">Feria</option>
                    <option value="sacrificio">Sacrificio</option>
                    <option value="otro">Otro</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Destino *</label>
                  <input required value={form.destino || ''} onChange={e => setForm({ ...form, destino: e.target.value })} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Fecha Salida *</label>
                  <input type="datetime-local" required value={form.fecha_salida || ''} onChange={e => setForm({ ...form, fecha_salida: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Estado</label>
                  <select value={form.estado || 'programado'} onChange={e => setForm({ ...form, estado: e.target.value })}>
                    <option value="programado">Programado</option>
                    <option value="en_transito">En Transito</option>
                    <option value="recibido">Recibido</option>
                    <option value="cancelado">Cancelado</option>
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Transportista</label>
                  <input value={form.transportista || ''} onChange={e => setForm({ ...form, transportista: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Placa Vehiculo</label>
                  <input value={form.placa_vehiculo || ''} onChange={e => setForm({ ...form, placa_vehiculo: e.target.value })} />
                </div>
              </div>
              <div className="form-group">
                <label>Guia de Movilizacion</label>
                <input value={form.guia_movilizacion || ''} onChange={e => setForm({ ...form, guia_movilizacion: e.target.value })} />
              </div>
              <div style={{ marginTop: 16, marginBottom: 12, paddingTop: 12, borderTop: '1px solid #e5e7eb' }}>
                <h4 style={{ fontSize: '0.95rem', color: '#374151', margin: 0, marginBottom: 12 }}>Datos Finca</h4>
                <div className="form-row">
                  <div className="form-group">
                    <label>Tipo Pasaje</label>
                    <select value={form.tipo_pasaje || ''} onChange={e => setForm({ ...form, tipo_pasaje: e.target.value })}>
                      <option value="">--</option>
                      <option value="F1">F1</option>
                      <option value="F2">F2</option>
                      <option value="F3">F3</option>
                      <option value="F4">F4</option>
                      <option value="F8">F8</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 28 }}>
                      <input type="checkbox" checked={!!form.satisface_retiro} onChange={e => setForm({ ...form, satisface_retiro: e.target.checked })} />
                      Satisface Retiro
                    </label>
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>Peso Pie Finca (kg)</label>
                    <input type="number" step="0.1" value={form.peso_pie_finca || ''} onChange={e => setForm({ ...form, peso_pie_finca: parseFloat(e.target.value) || '' })} />
                  </div>
                  <div className="form-group">
                    <label>Condición Corporal (1-12)</label>
                    <input type="number" min="1" max="12" value={form.condicion_corporal || ''} onChange={e => setForm({ ...form, condicion_corporal: parseInt(e.target.value) || '' })} />
                  </div>
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
