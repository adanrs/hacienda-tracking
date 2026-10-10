import { useState, useEffect } from 'react';
import { Plus, Trash2, CheckCircle, FileInput } from 'lucide-react';
import { api } from '../services/api';
import { confirmar } from '../components/ui/confirmar';
import { aviso } from '../components/ui/avisos';
import Escaner from '../components/ui/Escaner';
import { FilaEstado } from '../components/ui/Estados';
import { formatDate } from '../components/DateFormat';

const estadoBadge = { pendiente: 'badge-yellow', recibida: 'badge-green', cancelada: 'badge-gray' };

export default function OrdenesEntrada() {
  const [ordenes, setOrdenes] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState(null);
  const [bodegas, setBodegas] = useState([]);
  const [primales, setPrimales] = useState([]);
  const [cajas, setCajas] = useState([]);
  const [showNew, setShowNew] = useState(false);
  const [showView, setShowView] = useState(null);
  const [form, setForm] = useState({});
  const [items, setItems] = useState([]);
  const [guardando, setGuardando] = useState(false);

  const load = () => {
    setCargando(true);
    setErrorCarga(null);
    return api.getOrdenesEntrada()
      .then(setOrdenes)
      .catch(err => setErrorCarga(err.message))
      .finally(() => setCargando(false));
  };
  useEffect(() => {
    load();
    api.getBodegas().then(setBodegas).catch(aviso.errorCarga('las bodegas'));
    api.getPrimales().then(setPrimales).catch(aviso.errorCarga('los primales'));
    api.getCajas().then(setCajas).catch(aviso.errorCarga('las cajas'));
  }, []);

  // Escanear para agregar: busca el código entre cajas y primales y lo suma como ítem esperado.
  const leerItem = async (codigo) => {
    const c = codigo.toLowerCase();
    const caja = cajas.find(x => String(x.codigo).toLowerCase() === c);
    const primal = caja ? null : primales.find(x => String(x.codigo).toLowerCase() === c);
    const encontrado = caja || primal;
    if (!encontrado) throw new Error(`no hay caja ni primal con el código ${codigo}`);
    const tipo = caja ? 'caja' : 'primal';
    if (items.some(it => it.tipo === tipo && String(it.ref_id) === String(encontrado.id))) {
      throw new Error(`${codigo} ya está en la orden`);
    }
    const nuevo = { tipo, ref_id: encontrado.id, cantidad: 1, peso_esperado_kg: encontrado.peso_total_kg || encontrado.peso_kg || '' };
    setItems(prev => {
      const soloVacia = prev.length === 1 && !prev[0].ref_id;
      return soloVacia ? [nuevo] : [...prev, nuevo];
    });
    return {
      ok: true,
      titulo: `${caja ? 'Caja' : 'Primal'} agregado`,
      detalle: `${encontrado.codigo} · ${encontrado.tipo_corte || encontrado.tipo_primal || ''}`,
    };
  };

  const openNew = () => {
    setForm({ fecha: new Date().toISOString().split('T')[0] });
    setItems([{ tipo: 'primal', ref_id: '', cantidad: 1, peso_esperado_kg: '' }]);
    setShowNew(true);
  };

  const addItem = () => setItems([...items, { tipo: 'primal', ref_id: '', cantidad: 1, peso_esperado_kg: '' }]);
  const removeItem = (i) => setItems(items.filter((_, idx) => idx !== i));
  const updateItem = (i, k, v) => { const n = [...items]; n[i] = { ...n[i], [k]: v }; setItems(n); };
  // Al cambiar entre caja y primal se limpia la selección para no mandar el id de otro tipo.
  const cambiarTipo = (i, tipo) => { const n = [...items]; n[i] = { ...n[i], tipo, ref_id: '' }; setItems(n); };

  const save = async (e) => {
    e.preventDefault();
    if (guardando) return;
    setGuardando(true);
    try {
      const payload = {
        ...form,
        items: items.filter(it => it.ref_id).map(it => ({
          [it.tipo === 'caja' ? 'caja_id' : 'primal_id']: it.ref_id,
          cantidad: it.cantidad || 1,
          peso_esperado_kg: it.peso_esperado_kg || null,
        })),
      };
      await api.createOrdenEntrada(payload);
      aviso.ok(`Orden de entrada creada con ${payload.items.length} ítem(s)`);
      setShowNew(false);
      load();
    } catch (err) { aviso.error(err.message); } finally { setGuardando(false); }
  };

  const ver = async (id) => {
    try { const r = await api.getOrdenEntrada(id); setShowView(r); } catch (err) { aviso.error(err.message); }
  };

  const recibir = async (id) => {
    if (!(await confirmar({ titulo: '¿Confirmar la recepción de esta orden?', mensaje: 'Todos los ítems pasarán a la bodega destino.', textoConfirmar: 'Confirmar recepción' }))) return;
    try { await api.recibirOrdenEntrada(id); aviso.ok('Recepción confirmada'); load(); setShowView(null); } catch (err) { aviso.error(err.message); }
  };

  return (
    <div>
      <div className="page-header">
        <h2>Órdenes de entrada</h2>
        <button type="button" className="btn btn-primary btn-lg" onClick={openNew}><Plus size={20} aria-hidden="true" /> Nueva orden</button>
      </div>

      <div className="card">
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Número</th>
                <th>Fecha</th>
                <th>Origen</th>
                <th>Bodega destino</th>
                <th>Responsable</th>
                <th>Estado</th>
                <th>Recepción</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {!cargando && !errorCarga && ordenes.map(o => (
                <tr key={o.id}>
                  <td><strong>{o.numero}</strong></td>
                  <td>{formatDate(o.fecha)}</td>
                  <td>{o.origen || '-'}</td>
                  <td>{o.bodega_destino_codigo || '-'}</td>
                  <td>{o.responsable || '-'}</td>
                  <td><span className={`badge ${estadoBadge[o.estado] || 'badge-gray'}`}>{o.estado}</span></td>
                  <td>{o.fecha_recepcion ? formatDate(o.fecha_recepcion) : '-'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button type="button" className="btn-icon" onClick={() => ver(o.id)} title="Ver detalle" aria-label={`Ver detalle de ${o.numero}`}><FileInput size={18} aria-hidden="true" /></button>
                      {o.estado === 'pendiente' && (
                        <button type="button" className="btn-icon ok" onClick={() => recibir(o.id)} title="Confirmar recepción" aria-label={`Confirmar recepción de ${o.numero}`}><CheckCircle size={18} aria-hidden="true" /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              <FilaEstado
                columnas={8}
                cargando={cargando}
                error={errorCarga}
                onReintentar={load}
                vacio={ordenes.length === 0}
                tituloVacio="No hay órdenes de entrada"
                textoVacio="Cree una con «Nueva orden» cuando llegue producto del matadero o de CIISA."
              />
            </tbody>
          </table>
        </div>
      </div>

      {showNew && (
        // Sin cierre por clic fuera: un toque accidental no debe borrar una orden a medio llenar.
        <div className="modal-overlay">
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="titulo-nueva-oe" style={{ maxWidth: 780 }}>
            <div className="modal-header">
              <h3 id="titulo-nueva-oe">Nueva orden de entrada</h3>
              <button type="button" className="btn-icon" aria-label="Cerrar" onClick={() => setShowNew(false)}>&times;</button>
            </div>
            <form onSubmit={save}>
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="oe-fecha">Fecha *</label>
                  <input id="oe-fecha" type="date" required value={form.fecha || ''} onChange={e => setForm({ ...form, fecha: e.target.value })} />
                </div>
                <div className="form-group">
                  <label htmlFor="oe-responsable">Responsable</label>
                  <input id="oe-responsable" value={form.responsable || ''} onChange={e => setForm({ ...form, responsable: e.target.value })} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="oe-origen">Origen (matadero o proveedor)</label>
                  <input id="oe-origen" value={form.origen || ''} onChange={e => setForm({ ...form, origen: e.target.value })} />
                </div>
                <div className="form-group">
                  <label htmlFor="oe-bodega">Bodega destino</label>
                  <select id="oe-bodega" value={form.bodega_destino_id || ''} onChange={e => setForm({ ...form, bodega_destino_id: e.target.value })}>
                    <option value="">Seleccionar…</option>
                    {bodegas.map(b => <option key={b.id} value={b.id}>{b.codigo} - {b.nombre}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label htmlFor="oe-notas">Notas</label>
                <textarea id="oe-notas" rows={2} value={form.notas || ''} onChange={e => setForm({ ...form, notas: e.target.value })} />
              </div>

              <Escaner
                etiqueta="Escanear para agregar ítems"
                onLeer={leerItem}
                autoFocus={false}
                mantenerFoco={false}
                textoEspera="Escanee cajas o primales para sumarlos a la orden"
                ayuda="Cada lectura agrega una fila con el peso registrado. También puede agregarlas a mano."
              />

              <div style={{ marginTop: 12, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong>Ítems esperados ({items.filter(it => it.ref_id).length})</strong>
                <button type="button" className="btn btn-secondary" onClick={addItem}><Plus size={16} aria-hidden="true" /> Agregar a mano</button>
              </div>
              {items.map((it, i) => (
                <div key={i} className="fila-item" role="group" aria-label={`Ítem ${i + 1}`}>
                  <div className="form-group">
                    <span className="sr-only">Tipo</span>
                    <div className="opciones-radio">
                      <label><input type="radio" name={`oe-tipo-${i}`} checked={it.tipo === 'primal'} onChange={() => cambiarTipo(i, 'primal')} /> Primal</label>
                      <label><input type="radio" name={`oe-tipo-${i}`} checked={it.tipo === 'caja'} onChange={() => cambiarTipo(i, 'caja')} /> Caja</label>
                    </div>
                  </div>
                  <div className="form-group">
                    <label htmlFor={`oe-ref-${i}`}>{it.tipo === 'caja' ? 'Caja' : 'Primal'}</label>
                    <select id={`oe-ref-${i}`} value={it.ref_id} onChange={e => updateItem(i, 'ref_id', e.target.value)}>
                      <option value="">Seleccionar…</option>
                      {(it.tipo === 'caja' ? cajas : primales).map(x => (
                        <option key={x.id} value={x.id}>{x.codigo} {x.tipo_corte || x.tipo_primal || ''}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label htmlFor={`oe-cant-${i}`}>Cantidad</label>
                    <input id={`oe-cant-${i}`} type="number" min="1" inputMode="numeric" value={it.cantidad} onChange={e => updateItem(i, 'cantidad', parseInt(e.target.value) || 1)} />
                  </div>
                  <div className="form-group">
                    <label htmlFor={`oe-peso-${i}`}>Peso esperado (kg)</label>
                    <input id={`oe-peso-${i}`} type="number" step="0.01" inputMode="decimal" value={it.peso_esperado_kg} onChange={e => updateItem(i, 'peso_esperado_kg', parseFloat(e.target.value) || '')} />
                  </div>
                  <button type="button" className="btn-icon peligro" onClick={() => removeItem(i)} aria-label={`Quitar ítem ${i + 1}`} title="Quitar ítem"><Trash2 size={18} aria-hidden="true" /></button>
                </div>
              ))}

              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowNew(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary" disabled={guardando}>{guardando ? 'Creando…' : 'Crear orden'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showView && (
        <div className="modal-overlay" onClick={() => setShowView(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 700 }}>
            <div className="modal-header">
              <h3>Orden {showView.numero}</h3>
              <button type="button" className="btn-icon" aria-label="Cerrar" onClick={() => setShowView(null)}>&times;</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div><strong>Fecha:</strong> {formatDate(showView.fecha)}</div>
              <div><strong>Estado:</strong> <span className={`badge ${estadoBadge[showView.estado] || 'badge-gray'}`}>{showView.estado}</span></div>
              <div><strong>Origen:</strong> {showView.origen || '-'}</div>
              <div><strong>Bodega destino:</strong> {showView.bodega_destino_codigo || '-'}</div>
              {showView.fecha_recepcion && <div><strong>Recibida:</strong> {formatDate(showView.fecha_recepcion)}</div>}
            </div>
            <h4 style={{ marginBottom: 8 }}>Items</h4>
            <div className="table-container">
              <table>
                <thead><tr><th>Tipo</th><th>Código</th><th>Cant</th><th>Peso esperado</th><th>Peso recibido</th><th>Estado</th></tr></thead>
                <tbody>
                  {(showView.items || []).map(it => (
                    <tr key={it.id}>
                      <td>{it.primal_id ? 'Primal' : 'Caja'}</td>
                      <td>{it.primal_codigo || it.caja_codigo || '-'}</td>
                      <td>{it.cantidad || 1}</td>
                      <td>{it.peso_esperado_kg ? `${parseFloat(it.peso_esperado_kg).toFixed(2)} kg` : '-'}</td>
                      <td>{it.peso_recibido_kg ? `${parseFloat(it.peso_recibido_kg).toFixed(2)} kg` : '-'}</td>
                      <td>{it.recibido ? <span className="badge badge-green">Recibido</span> : <span className="badge badge-yellow">Pendiente</span>}</td>
                    </tr>
                  ))}
                  {(!showView.items || showView.items.length === 0) && <tr><td colSpan={6} className="empty-state">Sin items</td></tr>}
                </tbody>
              </table>
            </div>
            {showView.estado === 'pendiente' && (
              <div className="modal-actions">
                <button className="btn btn-primary" onClick={() => recibir(showView.id)}><CheckCircle size={16} /> Confirmar recepción</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
