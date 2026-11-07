import { useState, useEffect } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../services/api';
import { confirmar } from '../components/ui/confirmar';
import { aviso } from '../components/ui/avisos';
import { Link } from 'react-router-dom';
import AnimalSearch from '../components/AnimalSearch';
import { formatDate } from '../components/DateFormat';
import { FilaEstado, useEstadoCarga } from '../components/ui/Estados';

export default function Pesajes() {
  const [pesajes, setPesajes] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ tipo: 'rutinario' });

  const [carga, seguir] = useEstadoCarga();
  const load = () => seguir(api.getPesajes().then(setPesajes));
  useEffect(() => { load(); }, []);

  const save = async (e) => {
    e.preventDefault();
    if (!form.animal_id) { aviso.error('Seleccione un animal'); return; }
    try {
      await api.createPesaje(form);
      setShowModal(false);
      setForm({ tipo: 'rutinario' });
      load();
    } catch (err) { aviso.error(err.message); }
  };

  const remove = async (id) => {
    if (!(await confirmar({ titulo: '¿Eliminar este pesaje?', mensaje: 'Esta acción no se puede deshacer.', textoConfirmar: 'Eliminar', peligro: true }))) return;
    try {
      await api.deletePesaje(id);
      aviso.ok('Pesaje eliminado');
      load();
    } catch (err) { aviso.error(err.message); }
  };

  return (
    <div>
      <div className="page-header">
        <h2>Pesajes</h2>
        <button type="button" className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={16} aria-hidden="true" /> Nuevo pesaje</button>
      </div>
      <div className="card">
        <div className="table-container">
          <table>
            <thead><tr><th>Fecha</th><th>Animal</th><th>Peso (kg)</th><th>Tipo</th><th>Notas</th><th>Acciones</th></tr></thead>
            <tbody>
              {pesajes.map(p => (
                <tr key={p.id}>
                  <td>{formatDate(p.fecha)}</td>
                  <td><Link to={`/animales/${p.animal_id}`}>{p.numero_trazabilidad} {p.animal_nombre && `(${p.animal_nombre})`}</Link></td>
                  <td><strong>{p.peso_kg} kg</strong></td>
                  <td><span className="badge badge-green">{p.tipo}</span></td>
                  <td>{p.notas || '-'}</td>
                  <td><button type="button" className="btn-icon peligro" onClick={() => remove(p.id)} title="Eliminar pesaje" aria-label={`Eliminar pesaje de ${p.numero_trazabilidad} del ${formatDate(p.fecha)}`}><Trash2 size={16} aria-hidden="true" /></button></td>
                </tr>
              ))}
              <FilaEstado columnas={6} cargando={carga.cargando} error={carga.error} onReintentar={load}
                vacio={pesajes.length === 0} tituloVacio="Todavía no hay pesajes"
                textoVacio="Registre el primero con «Nuevo pesaje»." />
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h3>Nuevo pesaje</h3><button type="button" className="btn-icon" aria-label="Cerrar" onClick={() => setShowModal(false)}>&times;</button></div>
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
