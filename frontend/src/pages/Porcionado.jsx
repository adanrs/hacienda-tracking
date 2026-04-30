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
  const [catalogoCortes, setCatalogoCortes] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({});
  const [createdId, setCreatedId] = useState(null);
  const [showStickersFlow, setShowStickersFlow] = useState(false);
  const [cajaId, setCajaId] = useState(null);
  const [stickers, setStickers] = useState([]);
  const [createdStickers, setCreatedStickers] = useState([]);
  const [fechaEmpaqueCaja, setFechaEmpaqueCaja] = useState('');

  const load = () => api.getPorcionado().then(setItems).catch(console.error);

  useEffect(() => {
    load();
    api.getPrimales().then(ps => {
      setPrimales(ps.filter(p => ['en_porcionado', 'en_custodia', 'en_maduracion'].includes(p.estado)));
    }).catch(console.error);
    api.getCatalogoCortes().then(setCatalogoCortes).catch(console.error);
  }, []);

  const openNew = () => {
    setForm({ destino_trimming: 'carne_molida' });
    setCreatedId(null);
    setShowStickersFlow(false);
    setCajaId(null);
    setStickers([]);
    setCreatedStickers([]);
    setFechaEmpaqueCaja('');
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
        const fechaEmp = (form.fecha || '').split('T')[0] || new Date().toISOString().split('T')[0];
        const caja = await api.createCaja({
          porcionado_id: res.id || res.porcionado_id,
          tipo_corte: primal?.tipo_primal || 'Mixto',
          fecha_empaque: fechaEmp
        });
        setCajaId(caja.id);
        setFechaEmpaqueCaja(fechaEmp);
        setStickers([{ tipo_corte: primal?.tipo_primal || '', corte_codigo: '', peso_kg: '', codigo_box: '', codigo_lot: '' }]);
        setCreatedStickers([]);
        setShowStickersFlow(true);
      } else {
        setShowModal(false);
      }
    } catch (err) { alert(err.message); }
  };

  const addSticker = () => {
    if (stickers.length >= MAX_STICKERS_PER_CAJA) { alert(`Maximo ${MAX_STICKERS_PER_CAJA} stickers por caja`); return; }
    setStickers([...stickers, { tipo_corte: '', corte_codigo: '', peso_kg: '', codigo_box: '', codigo_lot: '' }]);
  };
  const updateSticker = (i, k, v) => {
    const n = [...stickers]; n[i] = { ...n[i], [k]: v }; setStickers(n);
  };
  const updateStickerCorte = (i, codigo) => {
    const c = catalogoCortes.find(x => x.codigo === codigo);
    const n = [...stickers];
    n[i] = { ...n[i], corte_codigo: codigo, tipo_corte: c ? c.nombre : '' };
    setStickers(n);
  };
  const removeSticker = (i) => setStickers(stickers.filter((_, idx) => idx !== i));

  const saveStickersAndClose = async () => {
    try {
      const created = [];
      for (const s of stickers) {
        if (!s.peso_kg) continue;
        const body = {
          caja_id: cajaId,
          tipo_corte: s.tipo_corte,
          peso_kg: parseFloat(s.peso_kg),
          fecha_empaque: fechaEmpaqueCaja || undefined,
        };
        if (s.corte_codigo) body.corte_codigo = s.corte_codigo;
        if (s.codigo_box) body.codigo_box = s.codigo_box;
        if (s.codigo_lot) body.codigo_lot = s.codigo_lot;
        const res = await api.createSticker(body);
        created.push(res);
      }
      setCreatedStickers(created);
      await api.cerrarCaja(cajaId);
      load();
      if (created.length === 0) {
        setShowModal(false);
      }
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
                  <div key={i} style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: 10, marginBottom: 10 }}>
                    <div className="form-row">
                      <div className="form-group">
                        <label>Corte (catalogo)</label>
                        <select value={s.corte_codigo || ''} onChange={e => updateStickerCorte(i, e.target.value)}>
                          <option value="">Seleccionar...</option>
                          {catalogoCortes.map(c => (
                            <option key={c.codigo} value={c.codigo}>{c.codigo} — {c.nombre}</option>
                          ))}
                        </select>
                      </div>
                      <div className="form-group">
                        <label>Peso (kg)</label>
                        <input type="number" step="0.01" value={s.peso_kg} onChange={e => updateSticker(i, 'peso_kg', e.target.value)} />
                      </div>
                    </div>
                    <div className="form-row">
                      <div className="form-group">
                        <label>Numero de caja (BOX)</label>
                        <input value={s.codigo_box || ''} onChange={e => updateSticker(i, 'codigo_box', e.target.value)} />
                      </div>
                      <div className="form-group">
                        <label>Lote / # Deshuese (LOT)</label>
                        <input value={s.codigo_lot || ''} onChange={e => updateSticker(i, 'codigo_lot', e.target.value)} placeholder="se completa automatico del deshuese" />
                      </div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <button type="button" className="btn-icon" onClick={() => removeSticker(i)}><Trash2 size={16} color="#dc2626" /></button>
                    </div>
                  </div>
                ))}
                <button type="button" className="btn btn-secondary" onClick={addSticker} disabled={stickers.length >= MAX_STICKERS_PER_CAJA}>
                  <Plus size={14} /> Agregar sticker
                </button>

                {createdStickers.length > 0 && (
                  <div style={{ marginTop: 16 }}>
                    <h4 style={{ marginBottom: 8 }}>Stickers generados</h4>
                    {createdStickers.map(st => {
                      const lb = st.peso_kg ? (parseFloat(st.peso_kg) * 2.20462).toFixed(2) : '0.00';
                      return (
                        <div key={st.id} style={{ padding: 10, border: '1px solid #e5e7eb', borderRadius: 6, marginBottom: 8, fontFamily: 'monospace', fontSize: '0.85rem' }}>
                          <div>CUE: {st.codigo_cue || '-'}</div>
                          <div>BOX: {st.codigo_box || '-'}</div>
                          <div>PESO: {st.peso_kg ? `${parseFloat(st.peso_kg).toFixed(2)} KG / ${lb} LB` : '-'}</div>
                          <div>LOT: {st.codigo_lot || '-'}</div>
                          <div style={{ marginTop: 6, color: '#6b7280' }}>
                            <div>Empaque: {formatDate(st.fecha_empaque)}</div>
                            <div>Mejor consumir antes: {formatDate(st.fecha_mejor_antes)}</div>
                            <div>Congelar hasta: {formatDate(st.fecha_congelar_hasta)}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="modal-actions">
                  <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>{createdStickers.length > 0 ? 'Cerrar' : 'Cerrar sin guardar'}</button>
                  {createdStickers.length === 0 && (
                    <button type="button" className="btn btn-primary" onClick={saveStickersAndClose}><Check size={14} /> Guardar y cerrar caja</button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
