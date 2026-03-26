import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search, Eye, Trash2, Edit } from 'lucide-react';
import { api } from '../services/api';
import { formatDate } from '../components/DateFormat';
import { CowIcon } from '../components/CowIcon';

const estadoBadge = { activo: 'badge-green', vendido: 'badge-blue', muerto: 'badge-red', trasladado: 'badge-yellow' };

export default function Animales() {
  const [animales, setAnimales] = useState([]);
  const [potreros, setPotreros] = useState([]);
  const [filters, setFilters] = useState({ search: '', estado: '', sexo: '', potrero_id: '' });
  const [showModal, setShowModal] = useState(false);
  const [editAnimal, setEditAnimal] = useState(null);
  const [form, setForm] = useState({});

  const load = () => {
    const params = {};
    Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
    api.getAnimales(params).then(setAnimales).catch(console.error);
  };

  useEffect(() => { load(); }, [filters]);
  useEffect(() => { api.getPotreros().then(setPotreros); }, []);

  const openNew = () => {
    setEditAnimal(null);
    setForm({ tipo: 'bovino', sexo: 'hembra', estado: 'activo' });
    setShowModal(true);
  };

  const openEdit = (a) => {
    setEditAnimal(a);
    setForm({ ...a });
    setShowModal(true);
  };

  const save = async (e) => {
    e.preventDefault();
    try {
      if (editAnimal) {
        await api.updateAnimal(editAnimal.id, form);
      } else {
        await api.createAnimal(form);
      }
      setShowModal(false);
      load();
    } catch (err) {
      alert(err.message);
    }
  };

  const remove = async (id) => {
    if (!confirm('Eliminar este animal?')) return;
    await api.deleteAnimal(id);
    load();
  };

  return (
    <div>
      <div className="page-header">
        <h2>Animales</h2>
        <button className="btn btn-primary" onClick={openNew}><Plus size={16} /> Nuevo Animal</button>
      </div>

      <div className="filter-bar">
        <div style={{ position: 'relative', flex: 1 }}>
          <Search size={16} style={{ position: 'absolute', left: 10, top: 8, color: '#9ca3af' }} />
          <input placeholder="Buscar por numero, nombre o raza..." value={filters.search} onChange={e => setFilters({ ...filters, search: e.target.value })} style={{ paddingLeft: 32, width: '100%' }} />
        </div>
        <select value={filters.estado} onChange={e => setFilters({ ...filters, estado: e.target.value })}>
          <option value="">Todos los estados</option>
          <option value="activo">Activo</option>
          <option value="vendido">Vendido</option>
          <option value="muerto">Muerto</option>
          <option value="trasladado">Trasladado</option>
        </select>
        <select value={filters.sexo} onChange={e => setFilters({ ...filters, sexo: e.target.value })}>
          <option value="">Ambos sexos</option>
          <option value="macho">Macho</option>
          <option value="hembra">Hembra</option>
        </select>
        <select value={filters.potrero_id} onChange={e => setFilters({ ...filters, potrero_id: e.target.value })}>
          <option value="">Todos los potreros</option>
          {potreros.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
      </div>

      <div className="card">
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th></th>
                <th>No. Trazabilidad</th>
                <th>Nombre</th>
                <th>Raza</th>
                <th>Sexo</th>
                <th>Peso Actual</th>
                <th>Potrero</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {animales.map(a => (
                <tr key={a.id}>
                  <td><CowIcon size={28} weight={a.peso_actual} color={a.sexo === 'macho' ? '#2563eb' : '#ec4899'} /></td>
                  <td><strong>{a.numero_trazabilidad}</strong></td>
                  <td>{a.nombre || '-'}</td>
                  <td>{a.raza}</td>
                  <td>{a.sexo}</td>
                  <td>{a.peso_actual ? <strong>{a.peso_actual} kg</strong> : <span style={{color:'#9ca3af'}}>-</span>}</td>
                  <td>{a.potrero_nombre || '-'}</td>
                  <td><span className={`badge ${estadoBadge[a.estado] || 'badge-gray'}`}>{a.estado}</span></td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <Link to={`/animales/${a.id}`} className="btn-icon"><Eye size={16} /></Link>
                      <button className="btn-icon" onClick={() => openEdit(a)}><Edit size={16} /></button>
                      <button className="btn-icon" onClick={() => remove(a.id)}><Trash2 size={16} color="#dc2626" /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {animales.length === 0 && <tr><td colSpan={9} className="empty-state">No se encontraron animales</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editAnimal ? 'Editar Animal' : 'Nuevo Animal'}</h3>
              <button className="btn-icon" onClick={() => setShowModal(false)}>&times;</button>
            </div>
            <form onSubmit={save}>
              <div className="form-row">
                <div className="form-group">
                  <label>No. Trazabilidad *</label>
                  <input required value={form.numero_trazabilidad || ''} onChange={e => setForm({ ...form, numero_trazabilidad: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Nombre</label>
                  <input value={form.nombre || ''} onChange={e => setForm({ ...form, nombre: e.target.value })} />
                </div>
              </div>
              <div className="form-row-3">
                <div className="form-group">
                  <label>Tipo *</label>
                  <select required value={form.tipo || 'bovino'} onChange={e => setForm({ ...form, tipo: e.target.value })}>
                    <option value="bovino">Bovino</option>
                    <option value="equino">Equino</option>
                    <option value="bufalino">Bufalino</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Raza</label>
                  <input value={form.raza || ''} onChange={e => setForm({ ...form, raza: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Sexo *</label>
                  <select required value={form.sexo || 'hembra'} onChange={e => setForm({ ...form, sexo: e.target.value })}>
                    <option value="hembra">Hembra</option>
                    <option value="macho">Macho</option>
                  </select>
                </div>
              </div>
              <div className="form-row-3">
                <div className="form-group">
                  <label>Fecha Nacimiento</label>
                  <input type="date" value={form.fecha_nacimiento || ''} onChange={e => setForm({ ...form, fecha_nacimiento: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Peso Nacimiento (kg)</label>
                  <input type="number" step="0.1" value={form.peso_nacimiento || ''} onChange={e => setForm({ ...form, peso_nacimiento: parseFloat(e.target.value) || '' })} />
                </div>
                <div className="form-group">
                  <label>Color</label>
                  <input value={form.color || ''} onChange={e => setForm({ ...form, color: e.target.value })} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Potrero</label>
                  <select value={form.potrero_id || ''} onChange={e => setForm({ ...form, potrero_id: e.target.value || null })}>
                    <option value="">Sin asignar</option>
                    {potreros.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Estado</label>
                  <select value={form.estado || 'activo'} onChange={e => setForm({ ...form, estado: e.target.value })}>
                    <option value="activo">Activo</option>
                    <option value="vendido">Vendido</option>
                    <option value="muerto">Muerto</option>
                    <option value="trasladado">Trasladado</option>
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label>Notas</label>
                <textarea rows={2} value={form.notas || ''} onChange={e => setForm({ ...form, notas: e.target.value })} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary">{editAnimal ? 'Guardar' : 'Crear'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
