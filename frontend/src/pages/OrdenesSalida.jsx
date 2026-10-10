import { useState, useEffect } from 'react';
import { Plus, Trash2, Send, FileOutput, CircleX } from 'lucide-react';
import { api } from '../services/api';
import { confirmar } from '../components/ui/confirmar';
import { aviso } from '../components/ui/avisos';
import Escaner from '../components/ui/Escaner';
import { FilaEstado } from '../components/ui/Estados';
import { formatDate } from '../components/DateFormat';

const estadoBadge = { pendiente: 'badge-yellow', en_preparacion: 'badge-blue', despachada: 'badge-green', cancelada: 'badge-gray' };

export default function OrdenesSalida() {
  const [ordenes, setOrdenes] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState(null);
  const [bodegas, setBodegas] = useState([]);
  const [cajas, setCajas] = useState([]);
  const [primales, setPrimales] = useState([]);
  const [showNew, setShowNew] = useState(false);
  const [showView, setShowView] = useState(null);
  const [form, setForm] = useState({});
  const [items, setItems] = useState([]);

  const load = () => {
    setCargando(true);
    setErrorCarga(null);
    return api.getOrdenesSalida()
      .then(setOrdenes)
      .catch(err => setErrorCarga(err.message))
      .finally(() => setCargando(false));
  };

  // Escanear para agregar: cajas cerradas o primales.
  const leerItem = async (codigo) => {
    const c = codigo.toLowerCase();
    const caja = cajas.find(x => String(x.codigo).toLowerCase() === c);
    const primal = caja ? null : primales.find(x => String(x.codigo).toLowerCase() === c);
    const encontrado = caja || primal;
    if (!encontrado) throw new Error(`${codigo} no es una caja cerrada ni un primal disponible`);
    const tipo = caja ? 'caja' : 'primal';
    if (items.some(it => it.tipo === tipo && String(it.ref_id) === String(encontrado.id))) {
      throw new Error(`${codigo} ya está en la orden`);
    }
    const nuevo = { tipo, ref_id: encontrado.id, cantidad: 1, peso_kg: encontrado.peso_total_kg || encontrado.peso_kg || '' };
    setItems(prev => (prev.length === 1 && !prev[0].ref_id ? [nuevo] : [...prev, nuevo]));
    return { ok: true, titulo: `${caja ? 'Caja' : 'Primal'} agregado`, detalle: `${encontrado.codigo} · ${encontrado.tipo_corte || encontrado.tipo_primal || ''}` };
  };

  useEffect(() => {
    load();
    api.getBodegas().then(setBodegas).catch(aviso.errorCarga('las bodegas'));
    api.getCajas({ estado: 'cerrada' }).then(setCajas).catch(aviso.errorCarga('las cajas'));
    api.getPrimales().then(setPrimales).catch(aviso.errorCarga('los primales'));
  }, []);

  const openNew = () => {
    setForm({ fecha: new Date().toISOString().split('T')[0] });
    setItems([{ tipo: 'caja', ref_id: '', cantidad: 1, peso_kg: '' }]);
    setShowNew(true);
  };

  const addItem = () => setItems([...items, { tipo: 'caja', ref_id: '', cantidad: 1, peso_kg: '' }]);
  const removeItem = (i) => setItems(items.filter((_, idx) => idx !== i));
  const updateItem = (i, k, v) => { const n = [...items]; n[i] = { ...n[i], [k]: v }; setItems(n); };
  const cambiarTipo = (i, tipo) => { const n = [...items]; n[i] = { ...n[i], tipo, ref_id: '' }; setItems(n); };

  const save = async (e) => {
    e.preventDefault();
    try {
      const payload = { ...form, items: items.filter(it => it.ref_id) };
      await api.createOrdenSalida(payload);
      aviso.ok(`Orden de salida creada con ${payload.items.length} ítem(s)`);
      setShowNew(false);
      load();
    } catch (err) { aviso.error(err.message); }
  };

  const ver = async (id) => {
    try { const r = await api.getOrdenSalida(id); setShowView(r); } catch (err) { aviso.error(err.message); }
  };

  const despachar = async (id) => {
    if (!(await confirmar({ titulo: '¿Despachar esta orden?', mensaje: 'Los ítems saldrán del inventario de la bodega.', textoConfirmar: 'Despachar' }))) return;
    try { await api.despacharOrden(id); aviso.ok('Orden despachada'); load(); } catch (err) { aviso.error(err.message); }
  };

  const cancelar = async (id) => {
    if (!(await confirmar({ titulo: '¿Anular esta orden de salida?', mensaje: 'La orden quedará cancelada y no se podrá despachar.', textoConfirmar: 'Anular orden', textoCancelar: 'Volver', peligro: true }))) return;
    try { await api.updateOrdenSalida(id, { estado: 'cancelada' }); aviso.ok('Orden anulada'); load(); } catch (err) { aviso.error(err.message); }
  };

  return (
    <div>
      <div className="page-header">
        <h2>Órdenes de salida</h2>
        <button type="button" className="btn btn-primary btn-lg" onClick={openNew}><Plus size={20} aria-hidden="true" /> Nueva orden</button>
      </div>

      <div className="card">
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Número</th>
                <th>Fecha</th>
                <th>Solicitante</th>
                <th>Destino</th>
                <th>Bodega</th>
                <th>Estado</th>
                <th>Ítems</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {!cargando && !errorCarga && ordenes.map(o => (
                <tr key={o.id}>
                  <td><strong>{o.numero || `#${o.id}`}</strong></td>
                  <td>{formatDate(o.fecha)}</td>
                  <td>{o.solicitante || '-'}</td>
                  <td>{o.destino || '-'}</td>
                  <td>{o.bodega_codigo || '-'}</td>
                  <td><span className={`badge ${estadoBadge[o.estado] || 'badge-gray'}`}>{o.estado}</span></td>
                  <td>{o.items_count || 0}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button type="button" className="btn-icon" onClick={() => ver(o.id)} title="Ver detalle" aria-label={`Ver detalle de la orden ${o.numero || o.id}`}><FileOutput size={18} aria-hidden="true" /></button>
                      {o.estado !== 'despachada' && o.estado !== 'cancelada' && (
                        <button type="button" className="btn-icon ok" onClick={() => despachar(o.id)} title="Despachar" aria-label={`Despachar la orden ${o.numero || o.id}`}><Send size={18} aria-hidden="true" /></button>
                      )}
                      {o.estado !== 'despachada' && o.estado !== 'cancelada' && (
                        <button type="button" className="btn-icon peligro" onClick={() => cancelar(o.id)} title="Anular" aria-label={`Anular la orden ${o.numero || o.id}`}><CircleX size={18} aria-hidden="true" /></button>
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
                tituloVacio="No hay órdenes de salida"
                textoVacio="Cree una con «Nueva orden» para despachar cajas o primales desde una bodega."
              />
            </tbody>
          </table>
        </div>
      </div>

      {showNew && (
        // Sin cierre por clic fuera: un toque accidental no debe borrar una orden a medio llenar.
        <div className="modal-overlay">
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="titulo-nueva-os" style={{ maxWidth: 780 }}>
            <div className="modal-header">
              <h3 id="titulo-nueva-os">Nueva orden de salida</h3>
              <button type="button" className="btn-icon" aria-label="Cerrar" onClick={() => setShowNew(false)}>&times;</button>
            </div>
            <form onSubmit={save}>
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="os-fecha">Fecha *</label>
                  <input id="os-fecha" type="date" required value={form.fecha || ''} onChange={e => setForm({ ...form, fecha: e.target.value })} />
                </div>
                <div className="form-group">
                  <label htmlFor="os-solicitante">Solicitante</label>
                  <input id="os-solicitante" value={form.solicitante || ''} onChange={e => setForm({ ...form, solicitante: e.target.value })} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="os-destino">Destino</label>
                  <input id="os-destino" value={form.destino || ''} onChange={e => setForm({ ...form, destino: e.target.value })} />
                </div>
                <div className="form-group">
                  <label htmlFor="os-bodega">Bodega de origen</label>
                  <select id="os-bodega" value={form.bodega_origen_id || ''} onChange={e => setForm({ ...form, bodega_origen_id: e.target.value })}>
                    <option value="">Seleccionar…</option>
                    {bodegas.map(b => <option key={b.id} value={b.id}>{b.codigo} - {b.nombre}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label htmlFor="os-notas">Notas</label>
                <textarea id="os-notas" rows={2} value={form.notas || ''} onChange={e => setForm({ ...form, notas: e.target.value })} />
              </div>

              <Escaner
                etiqueta="Escanear para agregar ítems"
                onLeer={leerItem}
                autoFocus={false}
                mantenerFoco={false}
                textoEspera="Escanee cajas cerradas o primales para sumarlos a la orden"
                ayuda="Cada lectura agrega una fila con el peso registrado. También puede agregarlas a mano."
              />

              <div style={{ marginTop: 12, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong>Ítems ({items.filter(it => it.ref_id).length})</strong>
                <button type="button" className="btn btn-secondary" onClick={addItem}><Plus size={16} aria-hidden="true" /> Agregar a mano</button>
              </div>
              {items.map((it, i) => (
                <div key={i} className="fila-item" role="group" aria-label={`Ítem ${i + 1}`}>
                  <div className="form-group">
                    <span className="sr-only">Tipo</span>
                    <div className="opciones-radio">
                      <label><input type="radio" name={`os-tipo-${i}`} checked={it.tipo === 'caja'} onChange={() => cambiarTipo(i, 'caja')} /> Caja</label>
                      <label><input type="radio" name={`os-tipo-${i}`} checked={it.tipo === 'primal'} onChange={() => cambiarTipo(i, 'primal')} /> Primal</label>
                    </div>
                  </div>
                  <div className="form-group">
                    <label htmlFor={`os-ref-${i}`}>{it.tipo === 'caja' ? 'Caja' : 'Primal'}</label>
                    <select id={`os-ref-${i}`} value={it.ref_id} onChange={e => updateItem(i, 'ref_id', e.target.value)}>
                      <option value="">Seleccionar…</option>
                      {(it.tipo === 'caja' ? cajas : primales).map(x => (
                        <option key={x.id} value={x.id}>{x.codigo} {x.tipo_corte || x.tipo_primal || ''}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label htmlFor={`os-cant-${i}`}>Cantidad</label>
                    <input id={`os-cant-${i}`} type="number" min="1" inputMode="numeric" value={it.cantidad} onChange={e => updateItem(i, 'cantidad', parseInt(e.target.value) || 1)} />
                  </div>
                  <div className="form-group">
                    <label htmlFor={`os-peso-${i}`}>Peso (kg)</label>
                    <input id={`os-peso-${i}`} type="number" step="0.01" inputMode="decimal" value={it.peso_kg} onChange={e => updateItem(i, 'peso_kg', parseFloat(e.target.value) || '')} />
                  </div>
                  <button type="button" className="btn-icon peligro" onClick={() => removeItem(i)} aria-label={`Quitar ítem ${i + 1}`} title="Quitar ítem"><Trash2 size={18} aria-hidden="true" /></button>
                </div>
              ))}

              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowNew(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary">Crear orden</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showView && (
        <div className="modal-overlay" onClick={() => setShowView(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 700 }}>
            <div className="modal-header">
              <h3>Orden {showView.numero || `#${showView.id}`}</h3>
              <button type="button" className="btn-icon" aria-label="Cerrar" onClick={() => setShowView(null)}>&times;</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div><strong>Fecha:</strong> {formatDate(showView.fecha)}</div>
              <div><strong>Estado:</strong> <span className={`badge ${estadoBadge[showView.estado] || 'badge-gray'}`}>{showView.estado}</span></div>
              <div><strong>Solicitante:</strong> {showView.solicitante || '-'}</div>
              <div><strong>Destino:</strong> {showView.destino || '-'}</div>
              <div><strong>Bodega:</strong> {showView.bodega_codigo || '-'}</div>
            </div>
            <h4 style={{ marginBottom: 8 }}>Items</h4>
            <div className="table-container">
              <table>
                <thead><tr><th>Tipo</th><th>Codigo</th><th>Descripcion</th><th>Cant</th><th>Peso</th></tr></thead>
                <tbody>
                  {(showView.items || []).map(it => (
                    <tr key={it.id}>
                      <td>{it.tipo}</td>
                      <td>{it.ref_codigo || '-'}</td>
                      <td>{it.descripcion || it.tipo_corte || it.tipo_primal || '-'}</td>
                      <td>{it.cantidad || 1}</td>
                      <td>{it.peso_kg ? `${parseFloat(it.peso_kg).toFixed(2)} kg` : '-'}</td>
                    </tr>
                  ))}
                  {(!showView.items || showView.items.length === 0) && <tr><td colSpan={5} className="empty-state">Sin items</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
