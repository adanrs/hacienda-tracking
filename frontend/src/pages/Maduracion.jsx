import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Clock, Send, Plus, Trash2, Thermometer } from 'lucide-react';
import { api } from '../services/api';
import { formatDate } from '../components/DateFormat';

const nivelBadge = { proximo: 'badge-green', urgente: 'badge-yellow', vencido: 'badge-red', olvidado: 'badge-red' };

function diasDesde(fecha) {
  if (!fecha) return null;
  const d = new Date(fecha);
  if (isNaN(d)) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

function diasBadge(dias) {
  if (dias === null || dias === undefined) return 'badge-gray';
  if (dias >= 45) return 'badge-red';
  if (dias >= 30) return 'badge-red';
  if (dias >= 28) return 'badge-yellow';
  if (dias >= 21) return 'badge-yellow';
  return 'badge-gray';
}

function diasColor(dias) {
  if (dias >= 45) return '#7f1d1d';
  if (dias >= 30) return '#dc2626';
  if (dias >= 28) return '#f97316';
  if (dias >= 21) return '#eab308';
  return '#6b7280';
}

const API_BASE = import.meta.env.VITE_API_URL || '/api';

const authHeaders = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${localStorage.getItem('token') || ''}`,
});

async function fetchJson(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, { headers: authHeaders(), ...options });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const body = await res.json(); msg = body.error || body.message || msg; } catch (_) {}
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  return res.json();
}

const callGetAlertasProximidad = () =>
  (api.getAlertasMaduracion ? api.getAlertasMaduracion() : fetchJson('/custodia/alertas-maduracion'));

const callGetTemperaturas = (params = {}) => {
  if (api.getTemperaturasBodega) return api.getTemperaturasBodega(params);
  const qs = new URLSearchParams(params).toString();
  return fetchJson(`/temperaturas-bodega${qs ? `?${qs}` : ''}`);
};

const callCreateTemperatura = (data) =>
  api.createTemperaturaBodega
    ? api.createTemperaturaBodega(data)
    : fetchJson('/temperaturas-bodega', { method: 'POST', body: JSON.stringify(data) });

const callDeleteTemperatura = (id) =>
  api.deleteTemperaturaBodega
    ? api.deleteTemperaturaBodega(id)
    : fetchJson(`/temperaturas-bodega/${id}`, { method: 'DELETE' });

const callGetResumenTemperaturas = (bodega_id) =>
  api.getResumenTemperaturas
    ? api.getResumenTemperaturas(bodega_id)
    : fetchJson(`/temperaturas-bodega/resumen/${bodega_id}`);

export default function Maduracion() {
  const [alertas, setAlertas] = useState([]);
  const [primales, setPrimales] = useState([]);
  const [bodegas, setBodegas] = useState([]);

  const [tempBodegaFilter, setTempBodegaFilter] = useState('');
  const [temperaturas, setTemperaturas] = useState([]);
  const [tempResumen, setTempResumen] = useState(null);
  const [showTempModal, setShowTempModal] = useState(false);
  const [tempForm, setTempForm] = useState({});

  const load = () => {
    callGetAlertasProximidad()
      .then(d => setAlertas(Array.isArray(d) ? d : []))
      .catch(err => { console.error(err); setAlertas([]); });
    api.getMaduracion().then(setPrimales).catch(console.error);
  };

  const loadTemperaturas = () => {
    const params = tempBodegaFilter ? { bodega_id: tempBodegaFilter } : {};
    callGetTemperaturas(params)
      .then(d => setTemperaturas(Array.isArray(d) ? d : []))
      .catch(err => { console.error(err); setTemperaturas([]); });
    if (tempBodegaFilter) {
      callGetResumenTemperaturas(tempBodegaFilter)
        .then(setTempResumen)
        .catch(err => { console.error(err); setTempResumen(null); });
    } else {
      setTempResumen(null);
    }
  };

  useEffect(() => {
    load();
    api.getBodegas().then(setBodegas).catch(console.error);
  }, []);

  useEffect(() => { loadTemperaturas(); }, [tempBodegaFilter]);

  const alertasProximidad = alertas.filter(a =>
    a.dias_restantes !== undefined && a.dias_restantes !== null && a.dias_restantes <= 5
  );

  const counts = { proximo: 0, urgente: 0, vencido: 0, olvidado: 0 };
  alertas.forEach(a => { if (counts[a.nivel] !== undefined) counts[a.nivel]++; });

  const bodegasPorcionado = bodegas.filter(b => b.tipo === 'porcionado');

  const enviarPorcionado = async (primal) => {
    if (bodegasPorcionado.length === 0) { alert('No hay bodegas de porcionado configuradas'); return; }
    const destino = bodegasPorcionado[0];
    if (!confirm(`Enviar ${primal.codigo} a ${destino.codigo}?`)) return;
    try {
      await api.moverBodega({ primal_id: primal.id, bodega_destino_id: destino.id, tipo: 'salida_porcionado' });
      load();
    } catch (err) { alert(err.message); }
  };

  const bodegasMaduracion = bodegas.filter(b => b.tipo === 'maduracion');

  const openTempModal = () => {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const localISO = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
    setTempForm({
      bodega_id: tempBodegaFilter || (bodegasMaduracion[0]?.id || ''),
      fecha: localISO,
      temperatura_c: '',
      responsable: '',
      notas: ''
    });
    setShowTempModal(true);
  };

  const submitTemp = async (e) => {
    e.preventDefault();
    try {
      await callCreateTemperatura({
        bodega_id: tempForm.bodega_id,
        fecha: tempForm.fecha,
        temperatura_c: parseFloat(tempForm.temperatura_c),
        responsable: tempForm.responsable || null,
        notas: tempForm.notas || null,
      });
      setShowTempModal(false);
      setTempForm({});
      loadTemperaturas();
    } catch (err) { alert(err.message); }
  };

  const deleteTemp = async (id) => {
    if (!confirm('Borrar este registro de temperatura?')) return;
    try {
      await callDeleteTemperatura(id);
      loadTemperaturas();
    } catch (err) { alert(err.message); }
  };

  const fmtNum = (v, dec = 1) => {
    if (v === null || v === undefined || v === '') return '-';
    const n = parseFloat(v);
    if (isNaN(n)) return '-';
    return n.toFixed(dec);
  };

  return (
    <div>
      <div className="page-header">
        <h2>Maduracion</h2>
      </div>

      {alertasProximidad.length > 0 && (
        <div style={{
          padding: '12px 16px', marginBottom: 16, borderRadius: 8,
          background: '#fff7ed', border: '1px solid #fdba74', color: '#9a3412'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Clock size={18} />
            <strong>{alertasProximidad.length} {alertasProximidad.length === 1 ? 'primal próximo' : 'primales próximos'} a cumplir maduración (≤5 días)</strong>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {alertasProximidad.map(a => (
              <span key={a.id} style={{
                background: '#fff', border: '1px solid #fdba74', borderRadius: 6,
                padding: '4px 10px', fontSize: '0.85rem', display: 'inline-flex', gap: 6, alignItems: 'center'
              }}>
                <strong>{a.codigo}</strong>
                {a.numero_trazabilidad ? <span style={{ color: '#6b7280' }}>{a.numero_trazabilidad}</span> : null}
                <span style={{ color: '#c2410c', fontWeight: 600 }}>{a.dias_restantes}d</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {(counts.olvidado > 0 || counts.vencido > 0 || counts.urgente > 0) && (
        <div style={{
          padding: '12px 16px', marginBottom: 16, borderRadius: 8,
          background: counts.olvidado > 0 ? '#7f1d1d' : counts.vencido > 0 ? '#fef2f2' : '#fffbeb',
          border: `1px solid ${counts.olvidado > 0 ? '#991b1b' : counts.vencido > 0 ? '#fecaca' : '#fde68a'}`,
          color: counts.olvidado > 0 ? '#fff' : counts.vencido > 0 ? '#991b1b' : '#92400e',
          display: 'flex', alignItems: 'center', gap: 8
        }}>
          <AlertTriangle size={18} />
          <strong>
            {counts.olvidado > 0
              ? `${counts.olvidado} primales OLVIDADOS (>45 dias sin movimiento) - revisión urgente`
              : counts.vencido > 0
                ? `${counts.vencido} primales vencidos requieren accion inmediata`
                : `${counts.urgente} primales en estado urgente`}
          </strong>
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginBottom: 12 }}>Alertas de Maduracion</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
          <div style={{ textAlign: 'center', padding: 12, background: '#f0fdf4', borderRadius: 8 }}>
            <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#16a34a' }}>{counts.proximo}</div>
            <span className="badge badge-green">Próximo (21-27d)</span>
          </div>
          <div style={{ textAlign: 'center', padding: 12, background: '#fffbeb', borderRadius: 8 }}>
            <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#eab308' }}>{counts.urgente}</div>
            <span className="badge badge-yellow">Urgente (28-29d)</span>
          </div>
          <div style={{ textAlign: 'center', padding: 12, background: '#fef2f2', borderRadius: 8 }}>
            <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#dc2626' }}>{counts.vencido}</div>
            <span className="badge badge-red">Vencido (30-44d)</span>
          </div>
          <div style={{ textAlign: 'center', padding: 12, background: '#7f1d1d', borderRadius: 8, color: '#fff' }}>
            <div style={{ fontSize: '1.8rem', fontWeight: 700 }}>{counts.olvidado}</div>
            <span className="badge badge-red">Olvidado (&gt;45d)</span>
          </div>
        </div>

        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Codigo</th>
                <th>Animal</th>
                <th>Tipo</th>
                <th>Dias</th>
                <th>Nivel</th>
              </tr>
            </thead>
            <tbody>
              {alertas.map(a => {
                const diasShown = a.dias_actual !== undefined ? a.dias_actual : a.dias_maduracion;
                const nivelShown = a.nivel || (a.dias_restantes !== undefined && a.dias_restantes <= 5 ? 'proximo' : '');
                return (
                  <tr key={a.id}>
                    <td><strong>{a.codigo}</strong></td>
                    <td>{a.numero_trazabilidad || '-'}</td>
                    <td>{a.tipo_primal}</td>
                    <td><span style={{ fontSize: '1.15rem', fontWeight: 700, color: diasColor(diasShown) }}>{diasShown !== undefined && diasShown !== null ? `${diasShown}d` : '-'}</span></td>
                    <td>{nivelShown ? <span className={`badge ${nivelBadge[nivelShown] || 'badge-gray'}`}>{nivelShown}</span> : '-'}</td>
                  </tr>
                );
              })}
              {alertas.length === 0 && <tr><td colSpan={5} className="empty-state">Sin alertas</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginBottom: 12 }}>Primales en Maduracion</h3>
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Codigo</th>
                <th>Animal</th>
                <th>Tipo</th>
                <th>Marmoleo</th>
                <th>Inicio</th>
                <th>Dias</th>
                <th>Bodega</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {primales.map(p => {
                const dias = p.dias_maduracion !== undefined ? p.dias_maduracion : diasDesde(p.fecha_maduracion_inicio);
                return (
                  <tr key={p.id}>
                    <td><strong>{p.codigo}</strong></td>
                    <td>{p.animal_id ? <Link to={`/animales/${p.animal_id}`}>{p.numero_trazabilidad || 'Ver'}</Link> : '-'}</td>
                    <td>{p.tipo_primal}</td>
                    <td>{p.marmoleo ? <span className="badge badge-blue">BMS {p.marmoleo}</span> : '-'}</td>
                    <td>{formatDate(p.fecha_maduracion_inicio)}</td>
                    <td><span className={`badge ${diasBadge(dias)}`}>{dias !== null ? `${dias}d` : '-'}</span></td>
                    <td>{p.bodega_codigo || '-'}</td>
                    <td>
                      <button className="btn-icon" onClick={() => enviarPorcionado(p)} title="Enviar a porcionado"><Send size={16} /></button>
                    </td>
                  </tr>
                );
              })}
              {primales.length === 0 && <tr><td colSpan={8} className="empty-state">Sin primales en maduracion</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
            <Thermometer size={18} /> Registro de Temperatura
          </h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select value={tempBodegaFilter} onChange={e => setTempBodegaFilter(e.target.value)}>
              <option value="">Todas las bodegas de maduración</option>
              {bodegasMaduracion.map(b => <option key={b.id} value={b.id}>{b.codigo} - {b.nombre}</option>)}
            </select>
            <button className="btn btn-primary" onClick={openTempModal}><Plus size={16} /> Nuevo registro</button>
          </div>
        </div>

        {tempResumen && (
          <div style={{
            padding: '10px 14px', marginBottom: 12, borderRadius: 8,
            background: '#f0f9ff', border: '1px solid #bae6fd', color: '#0c4a6e',
            fontSize: '0.9rem'
          }}>
            <strong>Período actual:</strong>{' '}
            {tempResumen.total ?? 0} registros,{' '}
            {tempResumen.pct_cumplimiento !== undefined && tempResumen.pct_cumplimiento !== null
              ? `${fmtNum(tempResumen.pct_cumplimiento, 1)}% cumplimiento`
              : '-% cumplimiento'}
            {tempResumen.min !== undefined && tempResumen.min !== null && (
              <>, min {fmtNum(tempResumen.min, 1)}°C</>
            )}
            {tempResumen.max !== undefined && tempResumen.max !== null && (
              <>, max {fmtNum(tempResumen.max, 1)}°C</>
            )}
            {tempResumen.avg !== undefined && tempResumen.avg !== null && (
              <>, avg {fmtNum(tempResumen.avg, 1)}°C</>
            )}
          </div>
        )}

        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Bodega</th>
                <th>Temperatura (°C)</th>
                <th>Cumple ≤4°C</th>
                <th>Responsable</th>
                <th>Notas</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {temperaturas.map(t => {
                const bodega = bodegas.find(b => String(b.id) === String(t.bodega_id));
                const cumple = t.cumple === 1 || t.cumple === true;
                return (
                  <tr key={t.id}>
                    <td>{formatDate(t.fecha)}</td>
                    <td>{t.bodega_codigo || (bodega ? bodega.codigo : '-')}</td>
                    <td><strong>{fmtNum(t.temperatura_c, 1)}</strong></td>
                    <td>
                      {cumple
                        ? <span className="badge badge-green">✓</span>
                        : <span className="badge badge-red">✗</span>}
                    </td>
                    <td>{t.responsable || '-'}</td>
                    <td style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.notas || ''}>{t.notas || '-'}</td>
                    <td>
                      <button className="btn-icon" onClick={() => deleteTemp(t.id)} title="Borrar"><Trash2 size={16} color="#dc2626" /></button>
                    </td>
                  </tr>
                );
              })}
              {temperaturas.length === 0 && <tr><td colSpan={7} className="empty-state">Sin registros de temperatura</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {showTempModal && (
        <div className="modal-overlay" onClick={() => setShowTempModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Nuevo registro de temperatura</h3>
              <button className="btn-icon" onClick={() => setShowTempModal(false)}>&times;</button>
            </div>
            <form onSubmit={submitTemp}>
              <div className="form-group">
                <label>Bodega *</label>
                <select required value={tempForm.bodega_id || ''} onChange={e => setTempForm({ ...tempForm, bodega_id: e.target.value })}>
                  <option value="">Seleccionar...</option>
                  {bodegasMaduracion.map(b => <option key={b.id} value={b.id}>{b.codigo} - {b.nombre}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Fecha *</label>
                <input type="datetime-local" required value={tempForm.fecha || ''} onChange={e => setTempForm({ ...tempForm, fecha: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Temperatura (°C) *</label>
                <input type="number" step="0.1" required value={tempForm.temperatura_c ?? ''} onChange={e => setTempForm({ ...tempForm, temperatura_c: e.target.value })} placeholder="ej. 2.5" />
              </div>
              <div className="form-group">
                <label>Responsable</label>
                <input value={tempForm.responsable || ''} onChange={e => setTempForm({ ...tempForm, responsable: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Notas</label>
                <textarea rows={2} value={tempForm.notas || ''} onChange={e => setTempForm({ ...tempForm, notas: e.target.value })} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowTempModal(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary">Guardar</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
