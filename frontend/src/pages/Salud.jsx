import { useState, useEffect } from 'react';
import { Plus, Trash2, AlertTriangle } from 'lucide-react';
import { api } from '../services/api';
import { confirmar } from '../components/ui/confirmar';
import { aviso } from '../components/ui/avisos';
import { Link } from 'react-router-dom';
import AnimalSearch from '../components/AnimalSearch';
import { formatDate } from '../components/DateFormat';
import { FilaEstado, useEstadoCarga } from '../components/ui/Estados';

const tipoBadge = { vacunacion: 'badge-green', desparasitacion: 'badge-blue', tratamiento: 'badge-yellow', cirugia: 'badge-red', examen: 'badge-gray', otro: 'badge-gray' };

export default function Salud() {
  const [eventos, setEventos] = useState([]);
  const [alertas, setAlertas] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ tipo: 'vacunacion' });
  const [tab, setTab] = useState('todos');

  const [carga, seguir] = useEstadoCarga();
  const load = () => {
    seguir(api.getEventosSalud().then(setEventos));
    api.getAlertasSalud(60).then(setAlertas).catch(aviso.errorCarga());
  };

  useEffect(() => { load(); }, []);

  const save = async (e) => {
    e.preventDefault();
    if (!form.animal_id) { aviso.error('Seleccione un animal'); return; }
    try {
      await api.createEventoSalud(form);
      setShowModal(false);
      setForm({ tipo: 'vacunacion' });
      load();
    } catch (err) { aviso.error(err.message); }
  };

  const remove = async (id) => {
    if (!(await confirmar({ titulo: '¿Eliminar este evento de salud?', mensaje: 'Esta acción no se puede deshacer.', textoConfirmar: 'Eliminar', peligro: true }))) return;
    try {
      await api.deleteEventoSalud(id);
      aviso.ok('Evento eliminado');
      load();
    } catch (err) { aviso.error(err.message); }
  };

  const items = tab === 'alertas' ? alertas : eventos;

  return (
    <div>
      <div className="page-header">
        <h2>Salud animal</h2>
        <button type="button" className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={16} aria-hidden="true" /> Nuevo evento</button>
      </div>

      {/* Pestañas como botones: con <div onClick> no se podían usar con teclado ni las anunciaba el lector. */}
      <div className="tabs" role="tablist" aria-label="Eventos de salud">
        <button type="button" role="tab" aria-selected={tab === 'todos'} className={`tab ${tab === 'todos' ? 'active' : ''}`} onClick={() => setTab('todos')}>Todos ({eventos.length})</button>
        <button type="button" role="tab" aria-selected={tab === 'alertas'} className={`tab ${tab === 'alertas' ? 'active' : ''}`} onClick={() => setTab('alertas')}><AlertTriangle size={14} aria-hidden="true" />Próximos ({alertas.length})</button>
      </div>

      <div className="card">
        <div className="table-container">
          <table>
            <thead><tr><th>Fecha</th><th>Animal</th><th>Tipo</th><th>Descripción</th><th>Producto</th><th>Veterinario</th><th>Próxima</th><th>Acciones</th></tr></thead>
            <tbody>
              {items.map(e => (
                <tr key={e.id}>
                  <td>{formatDate(e.fecha)}</td>
                  <td><Link to={`/animales/${e.animal_id}`}>{e.numero_trazabilidad}</Link></td>
                  <td><span className={`badge ${tipoBadge[e.tipo]}`}>{e.tipo}</span></td>
                  <td>{e.descripcion}</td>
                  <td>{e.producto || '-'}</td>
                  <td>{e.veterinario || '-'}</td>
                  <td>{formatDate(e.proxima_fecha)}</td>
                  <td><button type="button" className="btn-icon peligro" onClick={() => remove(e.id)} title="Eliminar evento" aria-label={`Eliminar evento de ${e.numero_trazabilidad} del ${formatDate(e.fecha)}`}><Trash2 size={16} aria-hidden="true" /></button></td>
                </tr>
              ))}
              <FilaEstado columnas={8} cargando={carga.cargando} error={carga.error} onReintentar={load}
                vacio={items.length === 0}
                tituloVacio={tab === 'alertas' ? 'Sin eventos próximos' : 'Todavía no hay eventos de salud'}
                textoVacio={tab === 'alertas' ? 'Ningún animal tiene un evento programado en los próximos 60 días.' : 'Registre vacunas, desparasitaciones o tratamientos con «Nuevo evento».'} />
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h3>Nuevo evento de salud</h3><button type="button" className="btn-icon" aria-label="Cerrar" onClick={() => setShowModal(false)}>&times;</button></div>
            <form onSubmit={save}>
              <div className="form-row">
                <div className="form-group">
                  <label>Animal *</label>
                  <AnimalSearch value={form.animal_id} onChange={id => setForm({ ...form, animal_id: id })} />
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
