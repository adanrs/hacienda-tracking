import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Send, Clock, Plus } from 'lucide-react';
import { api } from '../services/api';
import { aviso } from '../components/ui/avisos';
import Escaner from '../components/ui/Escaner';
import { FilaEstado } from '../components/ui/Estados';

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
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState(null);

  const load = () => {
    const params = filterBodega ? { bodega_id: filterBodega } : {};
    setCargando(true);
    setErrorCarga(null);
    api.getCustodia(params)
      .then(setPrimales)
      .catch(err => setErrorCarga(err.message))
      .finally(() => setCargando(false));
  };

  useEffect(() => { load(); }, [filterBodega]);
  useEffect(() => {
    api.getBodegas().then(setBodegas).catch(aviso.errorCarga('las bodegas'));
    api.getPrimales({ estado: 'en_deshuese' }).then(setPrimalesDisponibles).catch(aviso.errorCarga('los primales disponibles'));
  }, []);

  const bodegasCustodia = bodegas.filter(b => b.tipo === 'custodia' || b.tipo === 'maduracion');

  const openMover = (p) => { setMoverForm({ primal_id: p.id, tipo: 'paso_maduracion' }); setShowMover(true); };

  const onMoverDestinoChange = (id) => {
    const b = bodegas.find(x => String(x.id) === String(id));
    let tipo = moverForm.tipo;
    if (b && b.tipo === 'maduracion') tipo = 'paso_maduracion';
    else if (b && b.tipo === 'porcionado') tipo = 'salida_porcionado';
    setMoverForm({ ...moverForm, bodega_destino_id: id, tipo });
  };

  const submitMover = async (e) => {
    e.preventDefault();
    try {
      await api.moverBodega(moverForm);
      setShowMover(false);
      load();
    } catch (err) { aviso.error(err.message); }
  };

  // Lectura de la pistola: busca el primal entre los disponibles y lo selecciona en el formulario.
  const onScanRecibir = async (codigo) => {
    const match = primalesDisponibles.find(p => String(p.codigo).toLowerCase() === String(codigo).toLowerCase());
    if (!match) {
      throw new Error(`el primal ${codigo} no está disponible para recibir (debe venir de deshuese)`);
    }
    setRecibirForm(f => ({ ...f, primal_id: match.id }));
    return {
      ok: true,
      titulo: 'Primal OK',
      detalle: `${match.codigo} · ${match.tipo_primal} · ${parseFloat(match.peso_kg || 0).toFixed(2)} kg`,
    };
  };

  const submitRecibir = async (e) => {
    e.preventDefault();
    try {
      await api.recibirCustodia(recibirForm);
      const recibido = primalesDisponibles.find(p => String(p.id) === String(recibirForm.primal_id));
      aviso.ok(`Primal ${recibido?.codigo || ''} recibido en custodia`);
      setShowRecibir(false);
      setRecibirForm({});
      load();
      api.getPrimales({ estado: 'en_deshuese' }).then(setPrimalesDisponibles).catch(aviso.errorCarga('los primales disponibles'));
    } catch (err) { aviso.error(err.message); }
  };

  const iniciar = async (id) => {
    try { await api.iniciarMaduracion(id); aviso.ok('Maduración iniciada'); load(); } catch (err) { aviso.error(err.message); }
  };

  return (
    <div>
      <div className="page-header">
        <h2>Custodia</h2>
        <button type="button" className="btn btn-primary btn-lg" onClick={() => { setRecibirForm({}); setShowRecibir(true); }}><Plus size={20} aria-hidden="true" /> Recibir primal</button>
      </div>

      <div className="filter-bar">
        <label className="sr-only" htmlFor="filtro-bodega-custodia">Filtrar por bodega</label>
        <select id="filtro-bodega-custodia" value={filterBodega} onChange={e => setFilterBodega(e.target.value)}>
          <option value="">Todas las bodegas</option>
          {bodegasCustodia.map(b => <option key={b.id} value={b.id}>{b.codigo} - {b.nombre}</option>)}
        </select>
      </div>

      <div className="card">
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Código</th>
                <th>Animal</th>
                <th>Tipo</th>
                <th>Peso</th>
                <th>Marmoleo</th>
                <th>Bodega</th>
                <th>Ubicación</th>
                <th>Estado</th>
                <th>Días</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {!cargando && !errorCarga && primales.map(p => {
                const dias = diasDesde(p.fecha_ingreso_custodia);
                return (
                  <tr key={p.id}>
                    <td><strong>{p.codigo}</strong></td>
                    <td>{p.animal_id ? <Link to={`/animales/${p.animal_id}`}>{p.numero_trazabilidad || 'Ver'}</Link> : '-'}</td>
                    <td>{p.tipo_primal}</td>
                    <td>{p.peso_kg ? `${parseFloat(p.peso_kg).toFixed(2)} kg` : '-'}</td>
                    <td>{p.marmoleo ? <span className="badge badge-blue">BMS {p.marmoleo}</span> : '-'}</td>
                    <td>{p.bodega_codigo || '-'}</td>
                    <td>{p.ubicacion_bodega || '-'}</td>
                    <td><span className={`badge ${estadoBadge[p.estado] || 'badge-gray'}`}>{p.estado}</span></td>
                    <td>{dias !== null ? `${dias}d` : '-'}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button type="button" className="btn-icon" onClick={() => openMover(p)} title="Mover a otra bodega" aria-label={`Mover ${p.codigo} a otra bodega`}><Send size={18} aria-hidden="true" /></button>
                        {p.estado === 'en_custodia' && (
                          <button type="button" className="btn-icon" onClick={() => iniciar(p.id)} title="Iniciar maduración" aria-label={`Iniciar maduración de ${p.codigo}`}><Clock size={18} aria-hidden="true" /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              <FilaEstado
                columnas={10}
                cargando={cargando}
                error={errorCarga}
                onReintentar={load}
                vacio={primales.length === 0}
                tituloVacio="No hay primales en custodia"
                textoVacio="Use «Recibir primal» y escanee el código del primal que llega de deshuese."
              />
            </tbody>
          </table>
        </div>
      </div>

      {showMover && (
        <div className="modal-overlay" onClick={() => setShowMover(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Mover Primal</h3>
              <button type="button" className="btn-icon" aria-label="Cerrar" onClick={() => setShowMover(false)}>&times;</button>
            </div>
            <form onSubmit={submitMover}>
              <div className="form-group">
                <label>Bodega Destino *</label>
                <select required value={moverForm.bodega_destino_id || ''} onChange={e => onMoverDestinoChange(e.target.value)}>
                  <option value="">Seleccionar...</option>
                  {bodegas.map(b => <option key={b.id} value={b.id}>{b.codigo} - {b.nombre} ({b.tipo})</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Tipo Movimiento</label>
                <select value={moverForm.tipo || 'otro'} onChange={e => setMoverForm({ ...moverForm, tipo: e.target.value })}>
                  <option value="paso_maduracion">Pasar a maduracion</option>
                  <option value="salida_porcionado">Salida a porcionado</option>
                  <option value="devolucion">Devolucion</option>
                  <option value="otro">Otro movimiento</option>
                </select>
              </div>
              <div className="form-group">
                <label>Ubicación física en bodega (rack/posición)</label>
                <input value={moverForm.ubicacion_bodega || ''} onChange={e => setMoverForm({ ...moverForm, ubicacion_bodega: e.target.value })} placeholder="ej. Rack 3 - Pos B2" />
              </div>
              <div className="form-group">
                <label>Responsable</label>
                <input value={moverForm.responsable || ''} onChange={e => setMoverForm({ ...moverForm, responsable: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Notas</label>
                <textarea rows={2} value={moverForm.notas || ''} onChange={e => setMoverForm({ ...moverForm, notas: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Nota supervisor (si peso no coincide u otra observación)</label>
                <textarea rows={2} value={moverForm.nota_supervisor || ''} onChange={e => setMoverForm({ ...moverForm, nota_supervisor: e.target.value })} />
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
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="titulo-recibir" onClick={e => e.stopPropagation()} style={{ maxWidth: 680 }}>
            <div className="modal-header">
              <h3 id="titulo-recibir">Recibir primal</h3>
              <button type="button" className="btn-icon" aria-label="Cerrar" onClick={() => setShowRecibir(false)}>&times;</button>
            </div>
            <form onSubmit={submitRecibir}>
              <Escaner
                etiqueta="Código del primal"
                onLeer={onScanRecibir}
                ayuda="Dispare la pistola sobre la etiqueta del primal; se selecciona solo en la lista de abajo."
              />
              <div className="form-group">
                <label htmlFor="recibir-primal">Primal *</label>
                <select id="recibir-primal" required value={recibirForm.primal_id || ''} onChange={e => setRecibirForm({ ...recibirForm, primal_id: e.target.value })}>
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
                <label>Ubicación física en bodega (rack/posición)</label>
                <input value={recibirForm.ubicacion_bodega || ''} onChange={e => setRecibirForm({ ...recibirForm, ubicacion_bodega: e.target.value })} placeholder="ej. Rack 3 - Pos B2" />
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
