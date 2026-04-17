import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Trash2, Scissors, Check } from 'lucide-react';
import { api } from '../services/api';
import { formatDate } from '../components/DateFormat';

const destinoBadge = { carne_molida: 'badge-blue', chorizo: 'badge-yellow', tortas: 'badge-green', descarte: 'badge-red', otro: 'badge-gray' };
const MAX_STICKERS_PER_CAJA = 3;

export default function Porcionado() {
  const [items, setItems] = useState([]);
  const [primales, setPrimales] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({});
  const [createdId, setCreatedId] = useState(null);
  const [showStickersFlow, setShowStickersFlow] = useState(false);
  const [cajaId, setCajaId] = useState(null);
  const [stickers, setStickers] = useState([]);

  const load = () => api.getPorcionado().then(setItems).catch(console.error);

  useEffect(() => {
    load();
    api.getPrimales().then(ps => {
      setPrimales(ps.filter(p => ['en_porcionado', 'en_custodia', 'en_maduracion'].includes(p.estado)));
    }).catch(console.error);
  }, []);

  const openNew = () => {
    setForm({ destino_trimming: 'carne_molida' });
    setCreatedId(null);
    setShowStickersFlow(false);
    setCajaId(null);
    setStickers([]);
    setShowModal(true);
  };

  const trimmingLive = (() => {
    const pi = parseFloat(form.peso_inicial) || 0;
    const pf = parseFloat(form.peso_final) || 0;
    const bch = parseFloat(form.bch_kg) || 0;
    const t = pi - pf - bch;
    return t > 0 ? t.toFixed(2) : '0';
  })();

  const save = async (e) => {
    e.preventDefault();
    try {
      const payload = { ...form, trimming_kg: parseFloat(trimmingLive) };
      const res = await api.createPorcionado(payload);
      setCreatedId(res.id || res.porcionado_id);
      load();
      if (confirm('Porcionado creado. ¿Generar stickers y caja?')) {
        const primal = primales.find(p => String(p.id) === String(form.primal_id));
        const caja = await api.createCaja({
          porcionado_id: res.id || res.porcionado_id,
          tipo_corte: primal?.tipo_primal || 'Mixto',
          fecha_empaque: (form.fecha || '').split('T')[0] || new Date().toISOString().split('T')[0]
        });
        setCajaId(caja.id);
        setStickers([{ tipo_corte: primal?.tipo_primal || '', peso_kg: '' }]);
        setShowStickersFlow(true);
      } else {
        setShowModal(false);
      }
    } catch (err) { alert(err.message); }
  };

  const addSticker = () => {
    if (stickers.length >= MAX_STICKERS_PER_CAJA) { alert(`Maximo ${MAX_STICKERS_PER_CAJA} stickers por caja`); return; }
    setStickers([...stickers, { tipo_corte: '', peso_kg: '' }]);
  };
  const updateSticker = (i, k, v) => {
    const n = [...stickers]; n[i] = { ...n[i], [k]: v }; setStickers(n);
  };
  const removeSticker = (i) => setStickers(stickers.filter((_, idx) => idx !== i));

  const saveStickersAndClose = async () => {
    try {
      for (const s of stickers) {
        if (!s.peso_kg) continue;
        await api.createSticker({ caja_id: cajaId, tipo_corte: s.tipo_corte, peso_kg: parseFloat(s.peso_kg) });
      }
      await api.cerrarCaja(cajaId);
      setShowModal(false);
      load();
    } catch (err) { alert(err.message); }
  };

  const remove = async (id) => {
    if (!confirm('Eliminar este porcionado?')) return;
    try { await api.deletePorcionado(id); load(); } catch (err) { alert(err.message); }
  };

  return (
    <div>
      <div className="page-header">
        <h2>Porcionado</h2>
        <button className="btn btn-primary" onClick={openNew}><Plus size={16} /> Nuevo Porcionado</button>
      </div>

      <div className="card">
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Animal</th>
                <th>Primal</th>
                <th>Peso Inicial</th>
                <th>Peso Final</th>
                <th>Trimming</th>
                <th>BCH</th>
                <th>Destino Trim</th>
                <th>Responsable</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {items.map(p => (
                <tr key={p.id}>
                  <td>{formatDate(p.fecha)}</td>
                  <td>{p.animal_id ? <Link to={`/animales/${p.animal_id}`}>{p.numero_trazabilidad || 'Ver'}</Link> : '-'}</td>
                  <td>{p.primal_codigo || '-'} {p.tipo_primal && <span style={{ color: '#6b7280' }}>({p.tipo_primal})</span>}</td>
                  <td>{p.peso_inicial ? `${parseFloat(p.peso_inicial).toFixed(2)} kg` : '-'}</td>
                  <td>{p.peso_final ? `${parseFloat(p.peso_final).toFixed(2)} kg` : '-'}</td>
                  <td>{p.trimming_kg ? `${parseFloat(p.trimming_kg).toFixed(2)} kg` : '-'}</td>
                  <td>{p.bch_kg ? `${parseFloat(p.bch_kg).toFixed(2)} kg` : '-'}</td>
                  <td>{p.destino_trimming ? <span className={`badge ${destinoBadge[p.destino_trimming] || 'badge-gray'}`}>{p.destino_trimming}</span> : '-'}</td>
                  <td>{p.responsable || '-'}</td>
                  <td>
                    <button className="btn-icon" onClick={() => remove(p.id)}><Trash2 size={16} color="#dc2626" /></button>
                  </td>
                </tr>
              ))}
              {items.length === 0 && <tr><td colSpan={10} className="empty-state">Sin porcionados</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 700 }}>
            <div className="modal-header">
              <h3><Scissors size={18} style={{ verticalAlign: 'middle' }} /> {showStickersFlow ? 'Generar Stickers' : 'Nuevo Porcionado'}</h3>
              <button className="btn-icon" onClick={() => setShowModal(false)}>&times;</button>
            </div>

            {!showStickersFlow && (
              <form onSubmit={save}>
                <div className="form-group">
                  <label>Primal *</label>
                  <select required value={form.primal_id || ''} onChange={e => setForm({ ...form, primal_id: e.target.value })}>
                    <option value="">Seleccionar...</option>
                    {primales.map(p => (
                      <option key={p.id} value={p.id}>{p.codigo} - {p.tipo_primal} ({parseFloat(p.peso_kg || 0).toFixed(2)} kg, {p.estado})</option>
                    ))}
                  </select>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>Fecha *</label>
                    <input type="datetime-local" required value={form.fecha || ''} onChange={e => setForm({ ...form, fecha: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label>Responsable</label>
                    <input value={form.responsable || ''} onChange={e => setForm({ ...form, responsable: e.target.value })} />
                  </div>
                </div>
                <div className="form-row-3">
                  <div className="form-group">
                    <label>Peso Inicial (kg) *</label>
                    <input type="number" step="0.01" required value={form.peso_inicial || ''} onChange={e => setForm({ ...form, peso_inicial: parseFloat(e.target.value) || '' })} />
                  </div>
                  <div className="form-group">
                    <label>Peso Final (kg) *</label>
                    <input type="number" step="0.01" required value={form.peso_final || ''} onChange={e => setForm({ ...form, peso_final: parseFloat(e.target.value) || '' })} />
                  </div>
                  <div className="form-group">
                    <label>BCH (kg)</label>
                    <input type="number" step="0.01" value={form.bch_kg || ''} onChange={e => setForm({ ...form, bch_kg: parseFloat(e.target.value) || '' })} />
                  </div>
                </div>
                <div style={{ padding: '8px 12px', background: '#f0fdf4', borderRadius: 8, marginBottom: 12, textAlign: 'center' }}>
                  <span style={{ color: '#6b7280' }}>Trimming calculado: </span>
                  <strong>{trimmingLive} kg</strong>
                </div>
                <div className="form-group">
                  <label>Destino Trimming</label>
                  <select value={form.destino_trimming || 'carne_molida'} onChange={e => setForm({ ...form, destino_trimming: e.target.value })}>
                    <option value="carne_molida">Carne molida</option>
                    <option value="chorizo">Chorizo</option>
                    <option value="tortas">Tortas</option>
                    <option value="descarte">Descarte</option>
                    <option value="otro">Otro</option>
                  </select>
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
            )}

            {showStickersFlow && (
              <div>
                <div style={{ padding: 10, background: '#eff6ff', borderRadius: 6, marginBottom: 12, fontSize: '0.85rem' }}>
                  Caja creada. Agrega hasta {MAX_STICKERS_PER_CAJA} stickers.
                </div>
                {stickers.map((s, i) => (
                  <div key={i} className="form-row" style={{ alignItems: 'end' }}>
                    <div className="form-group">
                      <label>Tipo corte</label>
                      <input value={s.tipo_corte} onChange={e => updateSticker(i, 'tipo_corte', e.target.value)} />
                    </div>
                    <div className="form-group" style={{ display: 'flex', gap: 6 }}>
                      <div style={{ flex: 1 }}>
                        <label>Peso (kg)</label>
                        <input type="number" step="0.01" value={s.peso_kg} onChange={e => updateSticker(i, 'peso_kg', e.target.value)} />
                      </div>
                      <button type="button" className="btn-icon" onClick={() => removeSticker(i)} style={{ marginBottom: 2 }}><Trash2 size={16} color="#dc2626" /></button>
                    </div>
                  </div>
                ))}
                <button type="button" className="btn btn-secondary" onClick={addSticker} disabled={stickers.length >= MAX_STICKERS_PER_CAJA}>
                  <Plus size={14} /> Agregar sticker
                </button>
                <div className="modal-actions">
                  <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cerrar sin guardar</button>
                  <button type="button" className="btn btn-primary" onClick={saveStickersAndClose}><Check size={14} /> Guardar y cerrar caja</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
