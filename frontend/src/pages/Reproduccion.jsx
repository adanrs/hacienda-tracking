import { useState, useEffect } from 'react';
import { Plus, Edit } from 'lucide-react';
import { api } from '../services/api';
import { Link } from 'react-router-dom';
import AnimalSearch from '../components/AnimalSearch';
import { formatDate } from '../components/DateFormat';

const resultadoBadge = { gestante: 'badge-yellow', vacia: 'badge-gray', aborto: 'badge-red', parto_exitoso: 'badge-green', parto_complicado: 'badge-red' };

export default function Reproduccion() {
  const [registros, setRegistros] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editReg, setEditReg] = useState(null);
  const [form, setForm] = useState({ tipo: 'monta_natural', resultado: 'gestante' });

  const load = () => api.getReproduccion().then(setRegistros).catch(console.error);
  useEffect(() => { load(); }, []);

  const openEdit = (r) => { setEditReg(r); setForm({ ...r }); setShowModal(true); };
  const openNew = () => { setEditReg(null); setForm({ tipo: 'monta_natural', resultado: 'gestante' }); setShowModal(true); };

  const save = async (e) => {
    e.preventDefault();
    if (!form.hembra_id) { alert('Selecciona una hembra'); return; }
    try {
      if (editReg) {
        await api.updateReproduccion(editReg.id, form);
      } else {
        await api.createReproduccion(form);
      }
      setShowModal(false);
      load();
    } catch (err) { alert(err.message); }
  };

  return (
    <div>
      <div className="page-header">
        <h2>Reproduccion</h2>
        <button className="btn btn-primary" onClick={openNew}><Plus size={16} /> Nuevo Registro</button>
      </div>
      <div className="card">
        <div className="table-container">
          <table>
            <thead><tr><th>Fecha Servicio</th><th>Hembra</th><th>Macho</th><th>Tipo</th><th>Resultado</th><th>Parto Est.</th><th>Parto Real</th><th>Cria</th><th></th></tr></thead>
            <tbody>
              {registros.map(r => (
                <tr key={r.id}>
                  <td>{formatDate(r.fecha_servicio)}</td>
                  <td><Link to={`/animales/${r.hembra_id}`}>{r.hembra_trazabilidad} {r.hembra_nombre && `(${r.hembra_nombre})`}</Link></td>
                  <td>{r.macho_trazabilidad ? <Link to={`/animales/${r.macho_id}`}>{r.macho_trazabilidad}</Link> : '-'}</td>
                  <td>{r.tipo.replace(/_/g, ' ')}</td>
                  <td><span className={`badge ${resultadoBadge[r.resultado] || 'badge-gray'}`}>{r.resultado?.replace(/_/g, ' ') || '-'}</span></td>
                  <td>{formatDate(r.fecha_parto_estimada)}</td>
                  <td>{formatDate(r.fecha_parto_real)}</td>
                  <td>{r.cria_trazabilidad ? <Link to={`/animales/${r.cria_id}`}>{r.cria_trazabilidad}</Link> : '-'}</td>
                  <td><button className="btn-icon" onClick={() => openEdit(r)}><Edit size={16} /></button></td>
                </tr>
              ))}
              {registros.length === 0 && <tr><td colSpan={9} className="empty-state">Sin registros</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h3>{editReg ? 'Editar Registro' : 'Nuevo Registro'}</h3><button className="btn-icon" onClick={() => setShowModal(false)}>&times;</button></div>
            <form onSubmit={save}>
              <div className="form-row">
                <div className="form-group">
                  <label>Hembra *</label>
                  <AnimalSearch value={form.hembra_id} onChange={id => setForm({ ...form, hembra_id: id })} filter={a => a.sexo === 'hembra'} />
                </div>
                <div className="form-group">
                  <label>Macho</label>
                  <AnimalSearch value={form.macho_id} onChange={id => setForm({ ...form, macho_id: id })} filter={a => a.sexo === 'macho'} />
                </div>
              </div>
              <div className="form-row-3">
                <div className="form-group">
                  <label>Tipo *</label>
                  <select required value={form.tipo} onChange={e => setForm({ ...form, tipo: e.target.value })}>
                    <option value="monta_natural">Monta Natural</option>
                    <option value="inseminacion_artificial">Inseminacion Artificial</option>
                    <option value="transferencia_embrion">Transferencia Embrion</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Fecha Servicio *</label>
                  <input type="date" required value={form.fecha_servicio || ''} onChange={e => setForm({ ...form, fecha_servicio: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Resultado</label>
                  <select value={form.resultado || ''} onChange={e => setForm({ ...form, resultado: e.target.value })}>
                    <option value="gestante">Gestante</option>
                    <option value="vacia">Vacia</option>
                    <option value="aborto">Aborto</option>
                    <option value="parto_exitoso">Parto Exitoso</option>
                    <option value="parto_complicado">Parto Complicado</option>
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Parto Estimado</label>
                  <input type="date" value={form.fecha_parto_estimada || ''} onChange={e => setForm({ ...form, fecha_parto_estimada: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Parto Real</label>
                  <input type="date" value={form.fecha_parto_real || ''} onChange={e => setForm({ ...form, fecha_parto_real: e.target.value })} />
                </div>
              </div>
              <div className="form-group">
                <label>Notas</label>
                <textarea rows={2} value={form.notas || ''} onChange={e => setForm({ ...form, notas: e.target.value })} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary">{editReg ? 'Guardar' : 'Registrar'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
