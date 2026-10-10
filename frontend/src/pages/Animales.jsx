import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search, Eye, Trash2, Edit } from 'lucide-react';
import { api } from '../services/api';
import { confirmar } from '../components/ui/confirmar';
import { aviso } from '../components/ui/avisos';
import { FilaEstado } from '../components/ui/Estados';
import { CowIcon } from '../components/CowIcon';
import AnimalSearch from '../components/AnimalSearch';

const estadoBadge = { activo: 'badge-green', vendido: 'badge-blue', muerto: 'badge-red', trasladado: 'badge-yellow' };

export default function Animales() {
  const [animales, setAnimales] = useState([]);
  const [potreros, setPotreros] = useState([]);
  const [filters, setFilters] = useState({ search: '', estado: '', sexo: '', potrero_id: '' });
  const [showModal, setShowModal] = useState(false);
  const [editAnimal, setEditAnimal] = useState(null);
  const [form, setForm] = useState({});
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState(null);

  const load = () => {
    const params = {};
    Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
    setCargando(true);
    setErrorCarga(null);
    return api.getAnimales(params)
      .then(setAnimales)
      .catch(err => setErrorCarga(err.message))
      .finally(() => setCargando(false));
  };

  // La búsqueda espera a que se deje de teclear (300 ms) para no consultar en cada letra.
  useEffect(() => {
    const t = setTimeout(load, filters.search ? 300 : 0);
    return () => clearTimeout(t);
  }, [filters]);
  const hayFiltros = Object.values(filters).some(Boolean);
  useEffect(() => { api.getPotreros().then(setPotreros).catch(aviso.errorCarga('los potreros')); }, []);

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
      aviso.ok(editAnimal ? 'Cambios guardados' : `Animal ${form.numero_trazabilidad} registrado`);
      setShowModal(false);
      load();
    } catch (err) {
      aviso.error(err.message);
    }
  };

  const remove = async (id) => {
    if (!(await confirmar({ titulo: '¿Eliminar este animal?', mensaje: 'Se borra el animal y su historial asociado. Esta acción no se puede deshacer.', textoConfirmar: 'Eliminar', peligro: true }))) return;
    try {
      await api.deleteAnimal(id);
      aviso.ok('Animal eliminado');
      load();
    } catch (err) { aviso.error(err.message); }
  };

  return (
    <div>
      <div className="page-header">
        <h2>Animales</h2>
        <button type="button" className="btn btn-primary" onClick={openNew}><Plus size={18} aria-hidden="true" /> Nuevo animal</button>
      </div>

      <div className="filter-bar" role="search" aria-label="Filtrar animales">
        <div style={{ position: 'relative', flex: '1 1 240px' }}>
          <Search size={16} aria-hidden="true" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-terciario)' }} />
          <label className="sr-only" htmlFor="buscar-animal">Buscar animal</label>
          <input id="buscar-animal" type="search" placeholder="Buscar por número, nombre o raza…" value={filters.search} onChange={e => setFilters({ ...filters, search: e.target.value })} style={{ paddingLeft: 32, width: '100%' }} />
        </div>
        <label className="sr-only" htmlFor="filtro-estado-animal">Estado</label>
        <select id="filtro-estado-animal" value={filters.estado} onChange={e => setFilters({ ...filters, estado: e.target.value })}>
          <option value="">Todos los estados</option>
          <option value="activo">Activo</option>
          <option value="vendido">Vendido</option>
          <option value="muerto">Muerto</option>
          <option value="trasladado">Trasladado</option>
        </select>
        <label className="sr-only" htmlFor="filtro-sexo-animal">Sexo</label>
        <select id="filtro-sexo-animal" value={filters.sexo} onChange={e => setFilters({ ...filters, sexo: e.target.value })}>
          <option value="">Ambos sexos</option>
          <option value="macho">Macho</option>
          <option value="hembra">Hembra</option>
        </select>
        <label className="sr-only" htmlFor="filtro-potrero-animal">Potrero</label>
        <select id="filtro-potrero-animal" value={filters.potrero_id} onChange={e => setFilters({ ...filters, potrero_id: e.target.value })}>
          <option value="">Todos los potreros</option>
          {potreros.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
      </div>

      <div className="card">
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th><span className="sr-only">Ícono</span></th>
                <th>N.º de trazabilidad</th>
                <th className="col-secundaria">Nombre</th>
                <th className="col-secundaria">Raza</th>
                <th>Sexo</th>
                <th>Peso actual</th>
                <th>Potrero</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {!cargando && !errorCarga && animales.map(a => (
                <tr key={a.id}>
                  <td data-label-fija=""><CowIcon size={28} weight={a.peso_actual} color={a.sexo === 'macho' ? '#2563eb' : '#ec4899'} /></td>
                  <td><Link to={`/animales/${a.id}`}><strong>{a.numero_trazabilidad}</strong></Link></td>
                  <td className="col-secundaria">{a.nombre || '-'}</td>
                  <td className="col-secundaria">{a.raza}</td>
                  <td>{a.sexo}</td>
                  <td>{a.peso_actual ? <strong>{a.peso_actual} kg</strong> : '-'}</td>
                  <td>{a.potrero_nombre || '-'}</td>
                  <td><span className={`badge ${estadoBadge[a.estado] || 'badge-gray'}`}>{a.estado}</span></td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <Link to={`/animales/${a.id}`} className="btn-icon" title="Ver ficha" aria-label={`Ver ficha de ${a.numero_trazabilidad}`}><Eye size={18} aria-hidden="true" /></Link>
                      <button type="button" className="btn-icon" onClick={() => openEdit(a)} title="Editar" aria-label={`Editar ${a.numero_trazabilidad}`}><Edit size={18} aria-hidden="true" /></button>
                      <button type="button" className="btn-icon peligro" onClick={() => remove(a.id)} title="Eliminar" aria-label={`Eliminar ${a.numero_trazabilidad}`}><Trash2 size={18} aria-hidden="true" /></button>
                    </div>
                  </td>
                </tr>
              ))}
              <FilaEstado
                columnas={9}
                cargando={cargando}
                error={errorCarga}
                onReintentar={load}
                vacio={animales.length === 0}
                tituloVacio={hayFiltros ? 'Ningún animal coincide con los filtros' : 'Todavía no hay animales registrados'}
                textoVacio={hayFiltros ? 'Revise la búsqueda o quite algún filtro.' : 'Registre el primero con «Nuevo animal».'}
                accionVacio={hayFiltros
                  ? <button type="button" className="btn btn-secondary" onClick={() => setFilters({ search: '', estado: '', sexo: '', potrero_id: '' })}>Quitar filtros</button>
                  : null}
              />
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editAnimal ? 'Editar Animal' : 'Nuevo Animal'}</h3>
              <button type="button" className="btn-icon" aria-label="Cerrar" onClick={() => setShowModal(false)}>&times;</button>
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
              <div className="form-row">
                <div className="form-group">
                  <label>Madre</label>
                  <AnimalSearch value={form.madre_id} onChange={id => setForm({ ...form, madre_id: id })} filter={a => a.sexo === 'hembra'} />
                </div>
                <div className="form-group">
                  <label>Padre</label>
                  <AnimalSearch value={form.padre_id} onChange={id => setForm({ ...form, padre_id: id })} filter={a => a.sexo === 'macho'} />
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
