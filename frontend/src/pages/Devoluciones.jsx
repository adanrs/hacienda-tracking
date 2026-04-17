import { useState, useEffect } from 'react';
import { Plus, RotateCcw, Check } from 'lucide-react';
import { api } from '../services/api';
import { formatDate } from '../components/DateFormat';

const motivoBadge = {
  perdida_vacio: 'badge-red', producto_danado: 'badge-red', error_empaque: 'badge-yellow',
  vencido: 'badge-red', otro: 'badge-gray'
};

export default function Devoluciones() {
  const [items, setItems] = useState([]);
  const [cajas, setCajas] = useState([]);
  const [stickers, setStickers] = useState([]);
  const [primales, setPrimales] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ target: 'caja', motivo: 'producto_danado' });

  const load = () => api.getDevoluciones().then(setItems).catch(console.error);
  useEffect(() => {
    load();
    api.getCajas().then(setCajas).catch(console.error);
    api.getStickers().then(setStickers).catch(console.error);
    api.getPrimales().then(setPrimales).catch(console.error);
  }, []);

  const openNew = () => {
    setForm({ target: 'caja', motivo: 'producto_danado', fecha: new Date().toISOString().split('T')[0] });
    setShowModal(true);
  };

  const save = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        motivo: form.motivo,
        fecha: form.fecha,
        responsable: form.responsable,
        peso_kg: form.peso_kg,
        notas: form.notas
      };
      if (form.target === 'caja') payload.caja_id = form.ref_id;
      if (form.target === 'sticker') payload.sticker_id = form.ref_id;
      if (form.target === 'primal') payload.primal_id = form.ref_id;
      await api.createDevolucion(payload);
      setShowModal(false);
      load();
    } catch (err) { alert(err.message); }
  };

  const marcar = async (id) => {
    try { await api.marcarReprocesada(id); load(); } catch (err) { alert(err.message); }
  };

  const refOptions = form.target === 'caja' ? cajas : form.target === 'sticker' ? stickers : primales;

  return (
    <div>
      <div className="page-header">
        <h2>Devoluciones</h2>
        <button className="btn btn-primary" onClick={openNew}><Plus size={16} /> Nueva Devolucion</button>
      </div>

      <div className="card">
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Caja</th>
                <th>Sticker</th>
                <th>Primal</th>
                <th>Motivo</th>
                <th>Peso</th>
                <th>Responsable</th>
                <th>Reprocesado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {items.map(d => (
                <tr key={d.id}>
                  <td>{formatDate(d.fecha)}</td>
                  <td>{d.caja_codigo || '-'}</td>
                  <td>{d.sticker_codigo ? <span style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{d.sticker_codigo}</span> : '-'}</td>
                  <td>{d.primal_codigo || '-'}</td>
                  <td><span className={`badge ${motivoBadge[d.motivo] || 'badge-gray'}`}>{d.motivo}</span></td>
                  <td>{d.peso_kg ? `${parseFloat(d.peso_kg).toFixed(2)} kg` : '-'}</td>
                  <td>{d.responsable || '-'}</td>
                  <td><span className={`badge ${d.reprocesada ? 'badge-green' : 'badge-gray'}`}>{d.reprocesada ? 'Si' : 'No'}</span></td>
                  <td>
                    {!d.reprocesada && (
                      <button className="btn-icon" onClick={() => marcar(d.id)} title="Marcar reprocesada"><Check size={16} color="#16a34a" /></button>
                    )}
                  </td>
                </tr>
              ))}
              {items.length === 0 && <tr><td colSpan={9} className="empty-state">Sin devoluciones</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3><RotateCcw size={18} style={{ verticalAlign: 'middle' }} /> Nueva Devolucion</h3>
              <button className="btn-icon" onClick={() => setShowModal(false)}>&times;</button>
            </div>
            <form onSubmit={save}>
              <div className="form-group">
                <label>Tipo *</label>
                <div style={{ display: 'flex', gap: 12 }}>
                  <label><input type="radio" checked={form.target === 'caja'} onChange={() => setForm({ ...form, target: 'caja', ref_id: '' })} /> Caja</label>
                  <label><input type="radio" checked={form.target === 'sticker'} onChange={() => setForm({ ...form, target: 'sticker', ref_id: '' })} /> Sticker</label>
                  <label><input type="radio" checked={form.target === 'primal'} onChange={() => setForm({ ...form, target: 'primal', ref_id: '' })} /> Primal</label>
                </div>
              </div>
              <div className="form-group">
                <label>{form.target === 'caja' ? 'Caja' : form.target === 'sticker' ? 'Sticker' : 'Primal'} *</label>
                <select required value={form.ref_id || ''} onChange={e => setForm({ ...form, ref_id: e.target.value })}>
                  <option value="">Seleccionar...</option>
                  {refOptions.map(x => (
                    <option key={x.id} value={x.id}>
                      {x.codigo || x.codigo_barras} {x.tipo_corte || x.tipo_primal || ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Motivo *</label>
                  <select value={form.motivo} onChange={e => setForm({ ...form, motivo: e.target.value })}>
                    <option value="perdida_vacio">Perdida de vacio</option>
                    <option value="producto_danado">Producto dañado</option>
                    <option value="error_empaque">Error de empaque</option>
                    <option value="vencido">Vencido</option>
                    <option value="otro">Otro</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Fecha *</label>
                  <input type="date" required value={form.fecha || ''} onChange={e => setForm({ ...form, fecha: e.target.value })} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Responsable</label>
                  <input value={form.responsable || ''} onChange={e => setForm({ ...form, responsable: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Peso (kg)</label>
                  <input type="number" step="0.01" value={form.peso_kg || ''} onChange={e => setForm({ ...form, peso_kg: parseFloat(e.target.value) || '' })} />
                </div>
              </div>
              <div className="form-group">
                <label>Notas</label>
                <textarea rows={2} value={form.notas || ''} onChange={e => setForm({ ...form, notas: e.target.value })} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary">Crear</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
