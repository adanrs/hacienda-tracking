import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Send, Clock, Plus } from 'lucide-react';
import { api } from '../services/api';
import { formatDate } from '../components/DateFormat';

const estadoBadge = {
  en_deshuese: 'badge-gray', en_custodia: 'badge-blue', en_maduracion: 'badge-yellow',
  en_porcionado: 'badge-green', consumido: 'badge-gray', descartado: 'badge-red'
};

function diasDesde(fecha) {
  if (!fecha) return null;
  const d = new Date(fecha);
  if (isNaN(d)) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

export default function Custodia() {
  const [primales, setPrimales] = useState([]);
  const [bodegas, setBodegas] = useState([]);
  const [primalesDisponibles, setPrimalesDisponibles] = useState([]);
  const [filterBodega, setFilterBodega] = useState('');
  const [showMover, setShowMover] = useState(false);
  const [showRecibir, setShowRecibir] = useState(false);
  const [moverForm, setMoverForm] = useState({});
  const [recibirForm, setRecibirForm] = useState({});

  const load = () => {
    const params = filterBodega ? { bodega_id: filterBodega } : {};
    api.getCustodia(params).then(setPrimales).catch(console.error);
  };

  useEffect(() => { load(); }, [filterBodega]);
  useEffect(() => {
    api.getBodegas().then(setBodegas).catch(console.error);
    api.getPrimales({ estado: 'en_deshuese' }).then(setPrimalesDisponibles).catch(console.error);
  }, []);

  const bodegasCustodia = bodegas.filter(b => b.tipo === 'custodia' || b.tipo === 'maduracion');

  const openMover = (p) => { setMoverForm({ primal_id: p.id, tipo: 'movimiento' }); setShowMover(true); };

  const submitMover = async (e) => {
    e.preventDefault();
    try {
      await api.moverBodega(moverForm);
      setShowMover(false);
      load();
    } catch (err) { alert(err.message); }
  };

  const submitRecibir = async (e) => {
    e.preventDefault();
    try {
      await api.recibirCustodia(recibirForm);
      setShowRecibir(false);
      setRecibirForm({});
      load();
      api.getPrimales({ estado: 'en_deshuese' }).then(setPrimalesDisponibles);
    } catch (err) { alert(err.message); }
  };

  const iniciar = async (id) => {
    try { await api.iniciarMaduracion(id); load(); } catch (err) { alert(err.message); }
  };

  return (
    <div>
      <div className="page-header">
        <h2>Custodia</h2>
        <button className="btn btn-primary" onClick={() => { setRecibirForm({}); setShowRecibir(true); }}><Plus size={16} /> Recibir Primal</button>
      </div>

      <div className="filter-bar">
        <select value={filterBodega} onChange={e => setFilterBodega(e.target.value)}>
          <option value="">Todas las bodegas</option>
          {bodegasCustodia.map(b => <option key={b.id} value={b.id}>{b.codigo} - {b.nombre}</option>)}
        </select>
      </div>

      <div className="card">
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Codigo</th>
                <th>Animal</th>
                <th>Tipo</th>
                <th>Peso</th>
                <th>Marmoleo</th>
                <th>Bodega</th>
                <th>Estado</th>
                <th>Dias</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {primales.map(p => {
                const dias = diasDesde(p.fecha_ingreso_custodia);
                return (
                  <tr key={p.id}>
                    <td><strong>{p.codigo}</strong></td>
                    <td>{p.animal_id ? <Link to={`/animales/${p.animal_id}`}>{p.numero_trazabilidad || 'Ver'}</Link> : '-'}</td>
                    <td>{p.tipo_primal}</td>
                    <td>{p.peso_kg ? `${parseFloat(p.peso_kg).toFixed(2)} kg` : '-'}</td>
                    <td>{p.marmoleo ? <span className="badge badge-blue">BMS {p.marmoleo}</span> : '-'}</td>
                    <td>{p.bodega_codigo || '-'}</td>
                    <td><span className={`badge ${estadoBadge[p.estado] || 'badge-gray'}`}>{p.estado}</span></td>
                    <td>{dias !== null ? `${dias}d` : '-'}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="btn-icon" onClick={() => openMover(p)} title="Mover"><Send size={16} /></button>
                        {p.estado === 'en_custodia' && (
                          <button className="btn-icon" onClick={() => iniciar(p.id)} title="Iniciar maduracion"><Clock size={16} color="#eab308" /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {primales.length === 0 && <tr><td colSpan={9} className="empty-state">No hay primales en custodia</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {showMover && (
        <div className="modal-overlay" onClick={() => setShowMover(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Mover Primal</h3>
              <button className="btn-icon" onClick={() => setShowMover(false)}>&times;</button>
            </div>
            <form onSubmit={submitMover}>
              <div className="form-group">
                <label>Bodega Destino *</label>
                <select required value={moverForm.bodega_destino_id || ''} onChange={e => setMoverForm({ ...moverForm, bodega_destino_id: e.target.value })}>
                  <option value="">Seleccionar...</option>
                  {bodegas.map(b => <option key={b.id} value={b.id}>{b.codigo} - {b.nombre} ({b.tipo})</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Tipo Movimiento</label>
                <select value={moverForm.tipo || 'movimiento'} onChange={e => setMoverForm({ ...moverForm, tipo: e.target.value })}>
                  <option value="movimiento">Movimiento</option>
                  <option value="salida_maduracion">Salida maduracion</option>
                  <option value="salida_porcionado">Salida porcionado</option>
                </select>
              </div>
              <div className="form-group">
                <label>Responsable</label>
                <input value={moverForm.responsable || ''} onChange={e => setMoverForm({ ...moverForm, responsable: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Notas</label>
                <textarea rows={2} value={moverForm.notas || ''} onChange={e => setMoverForm({ ...moverForm, notas: e.target.value })} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowMover(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary">Mover</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showRecibir && (
        <div className="modal-overlay" onClick={() => setShowRecibir(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Recibir Primal</h3>
              <button className="btn-icon" onClick={() => setShowRecibir(false)}>&times;</button>
            </div>
            <form onSubmit={submitRecibir}>
              <div className="form-group">
                <label>Primal *</label>
                <select required value={recibirForm.primal_id || ''} onChange={e => setRecibirForm({ ...recibirForm, primal_id: e.target.value })}>
                  <option value="">Seleccionar...</option>
                  {primalesDisponibles.map(p => (
                    <option key={p.id} value={p.id}>{p.codigo} - {p.tipo_primal} ({parseFloat(p.peso_kg || 0).toFixed(2)} kg)</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Bodega Destino *</label>
                <select required value={recibirForm.bodega_destino_id || ''} onChange={e => setRecibirForm({ ...recibirForm, bodega_destino_id: e.target.value })}>
                  <option value="">Seleccionar...</option>
                  {bodegas.filter(b => b.tipo === 'custodia').map(b => <option key={b.id} value={b.id}>{b.codigo} - {b.nombre}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Responsable</label>
                <input value={recibirForm.responsable || ''} onChange={e => setRecibirForm({ ...recibirForm, responsable: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Notas</label>
                <textarea rows={2} value={recibirForm.notas || ''} onChange={e => setRecibirForm({ ...recibirForm, notas: e.target.value })} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowRecibir(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary">Recibir</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
