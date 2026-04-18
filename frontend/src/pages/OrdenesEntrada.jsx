import { useState, useEffect } from 'react';
import { Plus, Trash2, CheckCircle, FileInput } from 'lucide-react';
import { api } from '../services/api';
import { formatDate } from '../components/DateFormat';

const estadoBadge = { pendiente: 'badge-yellow', recibida: 'badge-green', cancelada: 'badge-gray' };

export default function OrdenesEntrada() {
  const [ordenes, setOrdenes] = useState([]);
  const [bodegas, setBodegas] = useState([]);
  const [primales, setPrimales] = useState([]);
  const [cajas, setCajas] = useState([]);
  const [showNew, setShowNew] = useState(false);
  const [showView, setShowView] = useState(null);
  const [form, setForm] = useState({});
  const [items, setItems] = useState([]);

  const load = () => api.getOrdenesEntrada().then(setOrdenes).catch(console.error);
  useEffect(() => {
    load();
    api.getBodegas().then(setBodegas).catch(console.error);
    api.getPrimales().then(setPrimales).catch(console.error);
    api.getCajas().then(setCajas).catch(console.error);
  }, []);

  const openNew = () => {
    setForm({ fecha: new Date().toISOString().split('T')[0] });
    setItems([{ tipo: 'primal', ref_id: '', cantidad: 1, peso_esperado_kg: '' }]);
    setShowNew(true);
  };

  const addItem = () => setItems([...items, { tipo: 'primal', ref_id: '', cantidad: 1, peso_esperado_kg: '' }]);
  const removeItem = (i) => setItems(items.filter((_, idx) => idx !== i));
  const updateItem = (i, k, v) => { const n = [...items]; n[i] = { ...n[i], [k]: v }; setItems(n); };

  const save = async (e) => {
    e.preventDefault();
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
      setShowNew(false);
      load();
    } catch (err) { alert(err.message); }
  };

  const ver = async (id) => {
    try { const r = await api.getOrdenEntrada(id); setShowView(r); } catch (err) { alert(err.message); }
  };

  const recibir = async (id) => {
    if (!confirm('Confirmar recepción de esta orden? Los items se moverán a la bodega destino.')) return;
    try { await api.recibirOrdenEntrada(id); load(); setShowView(null); } catch (err) { alert(err.message); }
  };

  return (
    <div>
      <div className="page-header">
        <h2>Órdenes de Entrada</h2>
        <button className="btn btn-primary" onClick={openNew}><Plus size={16} /> Nueva Orden</button>
      </div>

      <div className="card">
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Número</th>
                <th>Fecha</th>
                <th>Origen</th>
                <th>Bodega Destino</th>
                <th>Responsable</th>
                <th>Estado</th>
                <th>Recepción</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {ordenes.map(o => (
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
                      <button className="btn-icon" onClick={() => ver(o.id)} title="Ver"><FileInput size={16} /></button>
                      {o.estado === 'pendiente' && (
                        <button className="btn-icon" onClick={() => recibir(o.id)} title="Confirmar recepción"><CheckCircle size={16} color="#16a34a" /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {ordenes.length === 0 && <tr><td colSpan={8} className="empty-state">Sin órdenes de entrada</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {showNew && (
        <div className="modal-overlay" onClick={() => setShowNew(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 750 }}>
            <div className="modal-header">
              <h3>Nueva Orden de Entrada</h3>
              <button className="btn-icon" onClick={() => setShowNew(false)}>&times;</button>
            </div>
            <form onSubmit={save}>
              <div className="form-row">
                <div className="form-group">
                  <label>Fecha *</label>
                  <input type="date" required value={form.fecha || ''} onChange={e => setForm({ ...form, fecha: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Responsable</label>
                  <input value={form.responsable || ''} onChange={e => setForm({ ...form, responsable: e.target.value })} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Origen (matadero/proveedor)</label>
                  <input value={form.origen || ''} onChange={e => setForm({ ...form, origen: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Bodega Destino</label>
                  <select value={form.bodega_destino_id || ''} onChange={e => setForm({ ...form, bodega_destino_id: e.target.value })}>
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
                <strong>Items esperados</strong>
                <button type="button" className="btn btn-secondary" onClick={addItem}><Plus size={14} /> Agregar</button>
              </div>
              {items.map((it, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '120px 1fr 80px 120px 40px', gap: 8, marginBottom: 8, alignItems: 'end' }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label>Tipo</label>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <label style={{ fontSize: '0.85rem' }}><input type="radio" checked={it.tipo === 'primal'} onChange={() => updateItem(i, 'tipo', 'primal')} /> Primal</label>
                      <label style={{ fontSize: '0.85rem' }}><input type="radio" checked={it.tipo === 'caja'} onChange={() => updateItem(i, 'tipo', 'caja')} /> Caja</label>
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
                    <label>Peso esperado (kg)</label>
                    <input type="number" step="0.01" value={it.peso_esperado_kg} onChange={e => updateItem(i, 'peso_esperado_kg', parseFloat(e.target.value) || '')} />
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
              <h3>Orden {showView.numero}</h3>
              <button className="btn-icon" onClick={() => setShowView(null)}>&times;</button>
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
