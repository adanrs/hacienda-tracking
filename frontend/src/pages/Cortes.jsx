import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../services/api';
import { formatDate } from '../components/DateFormat';
import AnimalSearch from '../components/AnimalSearch';

const calidadBadge = { premium: 'badge-green', estandar: 'badge-blue', segunda: 'badge-yellow', industrial: 'badge-gray' };

export default function Cortes() {
  const [cortes, setCortes] = useState([]);
  const [sacrificios, setSacrificios] = useState([]);
  const [filters, setFilters] = useState({ sacrificio_id: '', animal_id: '' });
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({});

  const load = () => {
    const params = {};
    Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
    api.getCortes(params).then(setCortes).catch(console.error);
  };

  useEffect(() => { load(); }, [filters]);
  useEffect(() => { api.getSacrificios().then(setSacrificios).catch(console.error); }, []);

  const openNew = () => {
    setForm({ calidad: 'estandar', tipo_corte: 'Lomo' });
    setShowModal(true);
  };

  const save = async (e) => {
    e.preventDefault();
    try {
      await api.createCorte(form);
      setShowModal(false);
      load();
    } catch (err) {
      alert(err.message);
    }
  };

  const remove = async (id) => {
    if (!confirm('Eliminar este corte?')) return;
    await api.deleteCorte(id);
    load();
  };

  return (
    <div>
      <div className="page-header">
        <h2>Cortes</h2>
        <button className="btn btn-primary" onClick={openNew}><Plus size={16} /> Nuevo Corte</button>
      </div>

      <div className="filter-bar">
        <select value={filters.sacrificio_id} onChange={e => setFilters({ ...filters, sacrificio_id: e.target.value })}>
          <option value="">Todos los sacrificios</option>
          {sacrificios.map(s => (
            <option key={s.id} value={s.id}>
              {s.lote_sacrificio || `Sacrificio #${s.id}`} - {s.numero_trazabilidad || 'Animal'} ({formatDate(s.fecha)})
            </option>
          ))}
        </select>
        <div style={{ minWidth: 250 }}>
          <AnimalSearch value={filters.animal_id} onChange={id => setFilters({ ...filters, animal_id: id || '' })} />
        </div>
      </div>

      <div className="card">
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Animal</th>
                <th>Tipo Corte</th>
                <th>Peso (kg)</th>
                <th>Calidad</th>
                <th>Destino</th>
                <th>Lote Empaque</th>
                <th>Fecha Empaque</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {cortes.map(c => (
                <tr key={c.id}>
                  <td>{c.animal_id ? <Link to={`/animales/${c.animal_id}`}>{c.numero_trazabilidad || 'Ver animal'}</Link> : '-'}</td>
                  <td>{c.tipo_corte}</td>
                  <td>{c.peso_kg ? `${c.peso_kg} kg` : '-'}</td>
                  <td><span className={`badge ${calidadBadge[c.calidad] || 'badge-gray'}`}>{c.calidad || '-'}</span></td>
                  <td>{c.destino || '-'}</td>
                  <td>{c.lote_empaque || '-'}</td>
                  <td>{formatDate(c.fecha_empaque)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn-icon" onClick={() => remove(c.id)}><Trash2 size={16} color="#dc2626" /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {cortes.length === 0 && <tr><td colSpan={8} className="empty-state">No se encontraron cortes</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Nuevo Corte</h3>
              <button className="btn-icon" onClick={() => setShowModal(false)}>&times;</button>
            </div>
            <form onSubmit={save}>
              <div className="form-group">
                <label>Sacrificio *</label>
                <select required value={form.sacrificio_id || ''} onChange={e => setForm({ ...form, sacrificio_id: e.target.value })}>
                  <option value="">Seleccionar sacrificio...</option>
                  {sacrificios.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.lote_sacrificio || `Sacrificio #${s.id}`} - {s.numero_trazabilidad || 'Animal'} ({formatDate(s.fecha)})
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Tipo de Corte *</label>
                  <select required value={form.tipo_corte || 'Lomo'} onChange={e => setForm({ ...form, tipo_corte: e.target.value })}>
                    <option value="Lomo">Lomo</option>
                    <option value="Costilla">Costilla</option>
                    <option value="Pierna">Pierna</option>
                    <option value="Paleta">Paleta</option>
                    <option value="Pecho">Pecho</option>
                    <option value="Falda">Falda</option>
                    <option value="Aguja">Aguja</option>
                    <option value="Osobuco">Osobuco</option>
                    <option value="Hueso">Hueso</option>
                    <option value="Trim">Trim</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Peso (kg) *</label>
                  <input type="number" step="0.01" required value={form.peso_kg || ''} onChange={e => setForm({ ...form, peso_kg: parseFloat(e.target.value) || '' })} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Calidad</label>
                  <select value={form.calidad || 'estandar'} onChange={e => setForm({ ...form, calidad: e.target.value })}>
                    <option value="premium">Premium</option>
                    <option value="estandar">Estandar</option>
                    <option value="segunda">Segunda</option>
                    <option value="industrial">Industrial</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Destino</label>
                  <input value={form.destino || ''} onChange={e => setForm({ ...form, destino: e.target.value })} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Lote Empaque</label>
                  <input value={form.lote_empaque || ''} onChange={e => setForm({ ...form, lote_empaque: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Fecha Empaque</label>
                  <input type="date" value={form.fecha_empaque || ''} onChange={e => setForm({ ...form, fecha_empaque: e.target.value })} />
                </div>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary">Crear</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
