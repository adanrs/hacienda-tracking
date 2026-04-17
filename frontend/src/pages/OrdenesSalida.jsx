import { useState, useEffect } from 'react';
import { Plus, Trash2, Send, FileOutput, Edit } from 'lucide-react';
import { api } from '../services/api';
import { formatDate } from '../components/DateFormat';

const estadoBadge = { pendiente: 'badge-yellow', en_preparacion: 'badge-blue', despachada: 'badge-green', cancelada: 'badge-gray' };

export default function OrdenesSalida() {
  const [ordenes, setOrdenes] = useState([]);
  const [bodegas, setBodegas] = useState([]);
  const [cajas, setCajas] = useState([]);
  const [primales, setPrimales] = useState([]);
  const [showNew, setShowNew] = useState(false);
  const [showView, setShowView] = useState(null);
  const [form, setForm] = useState({});
  const [items, setItems] = useState([]);

  const load = () => api.getOrdenesSalida().then(setOrdenes).catch(console.error);
  useEffect(() => {
    load();
    api.getBodegas().then(setBodegas).catch(console.error);
    api.getCajas({ estado: 'cerrada' }).then(setCajas).catch(console.error);
    api.getPrimales().then(setPrimales).catch(console.error);
  }, []);

  const openNew = () => {
    setForm({ fecha: new Date().toISOString().split('T')[0] });
    setItems([{ tipo: 'caja', ref_id: '', cantidad: 1, peso_kg: '' }]);
    setShowNew(true);
  };

  const addItem = () => setItems([...items, { tipo: 'caja', ref_id: '', cantidad: 1, peso_kg: '' }]);
  const removeItem = (i) => setItems(items.filter((_, idx) => idx !== i));
  const updateItem = (i, k, v) => { const n = [...items]; n[i] = { ...n[i], [k]: v }; setItems(n); };

  const save = async (e) => {
    e.preventDefault();
    try {
      const payload = { ...form, items: items.filter(it => it.ref_id) };
      await api.createOrdenSalida(payload);
      setShowNew(false);
      load();
    } catch (err) { alert(err.message); }
  };

  const ver = async (id) => {
    try { const r = await api.getOrdenSalida(id); setShowView(r); } catch (err) { alert(err.message); }
  };

  const despachar = async (id) => {
    if (!confirm('Despachar esta orden?')) return;
    try { await api.despacharOrden(id); load(); } catch (err) { alert(err.message); }
  };

  const cancelar = async (id) => {
    if (!confirm('Cancelar esta orden?')) return;
    try { await api.updateOrdenSalida(id, { estado: 'cancelada' }); load(); } catch (err) { alert(err.message); }
  };

  return (
    <div>
      <div className="page-header">
        <h2>Ordenes de Salida</h2>
        <button className="btn btn-primary" onClick={openNew}><Plus size={16} /> Nueva Orden</button>
      </div>

      <div className="card">
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Numero</th>
                <th>Fecha</th>
                <th>Solicitante</th>
                <th>Destino</th>
                <th>Bodega</th>
                <th>Estado</th>
                <th>Items</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {ordenes.map(o => (
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
                      <button className="btn-icon" onClick={() => ver(o.id)}><FileOutput size={16} /></button>
                      {o.estado !== 'despachada' && o.estado !== 'cancelada' && (
                        <button className="btn-icon" onClick={() => despachar(o.id)} title="Despachar"><Send size={16} color="#16a34a" /></button>
                      )}
                      {o.estado !== 'despachada' && o.estado !== 'cancelada' && (
                        <button className="btn-icon" onClick={() => cancelar(o.id)} title="Cancelar"><Trash2 size={16} color="#dc2626" /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {ordenes.length === 0 && <tr><td colSpan={8} className="empty-state">Sin ordenes</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {showNew && (
        <div className="modal-overlay" onClick={() => setShowNew(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 750 }}>
            <div className="modal-header">
              <h3>Nueva Orden de Salida</h3>
              <button className="btn-icon" onClick={() => setShowNew(false)}>&times;</button>
            </div>
            <form onSubmit={save}>
              <div className="form-row">
                <div className="form-group">
                  <label>Fecha *</label>
                  <input type="date" required value={form.fecha || ''} onChange={e => setForm({ ...form, fecha: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Solicitante</label>
                  <input value={form.solicitante || ''} onChange={e => setForm({ ...form, solicitante: e.target.value })} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Destino</label>
                  <input value={form.destino || ''} onChange={e => setForm({ ...form, destino: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Bodega Origen</label>
                  <select value={form.bodega_origen_id || ''} onChange={e => setForm({ ...form, bodega_origen_id: e.target.value })}>
                    <option value="">Seleccionar...</option>
                    {bodegas.map(b => <option key={b.id} value={b.id}>{b.codigo} - {b.nombre}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label>Notas</label>
                <textarea rows={2} value={form.notas || ''} onChange={e => setForm({ ...form, notas: e.target.value })} />
              </div>

              <div style={{ marginTop: 12, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong>Items</strong>
                <button type="button" className="btn btn-secondary" onClick={addItem}><Plus size={14} /> Agregar</button>
              </div>
              {items.map((it, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '120px 1fr 80px 100px 40px', gap: 8, marginBottom: 8, alignItems: 'end' }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label>Tipo</label>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <label style={{ fontSize: '0.85rem' }}><input type="radio" checked={it.tipo === 'caja'} onChange={() => updateItem(i, 'tipo', 'caja')} /> Caja</label>
                      <label style={{ fontSize: '0.85rem' }}><input type="radio" checked={it.tipo === 'primal'} onChange={() => updateItem(i, 'tipo', 'primal')} /> Primal</label>
                    </div>
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label>{it.tipo === 'caja' ? 'Caja' : 'Primal'}</label>
                    <select value={it.ref_id} onChange={e => updateItem(i, 'ref_id', e.target.value)}>
                      <option value="">Seleccionar...</option>
                      {(it.tipo === 'caja' ? cajas : primales).map(x => (
                        <option key={x.id} value={x.id}>{x.codigo} {x.tipo_corte || x.tipo_primal || ''}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label>Cant</label>
                    <input type="number" min="1" value={it.cantidad} onChange={e => updateItem(i, 'cantidad', parseInt(e.target.value) || 1)} />
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label>Peso (kg)</label>
                    <input type="number" step="0.01" value={it.peso_kg} onChange={e => updateItem(i, 'peso_kg', parseFloat(e.target.value) || '')} />
                  </div>
                  <button type="button" className="btn-icon" onClick={() => removeItem(i)} style={{ marginBottom: 2 }}><Trash2 size={16} color="#dc2626" /></button>
                </div>
              ))}

              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowNew(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary">Crear</button>
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
              <button className="btn-icon" onClick={() => setShowView(null)}>&times;</button>
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
