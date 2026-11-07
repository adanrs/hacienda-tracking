import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Clock, Send, Plus, Trash2, Thermometer, X } from 'lucide-react';
import { api } from '../services/api';
import { soloLegacy } from '../services/bodegas';
import { confirmar } from '../components/ui/confirmar';
import { aviso } from '../components/ui/avisos';
import { formatDate } from '../components/DateFormat';
import { FilaEstado, useEstadoCarga } from '../components/ui/Estados';

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

// Clase de texto por días de maduración (tokens del sistema; el amarillo anterior no llegaba a 4.5:1).
function diasClase(dias) {
  if (dias >= 30) return 'texto-error';
  if (dias >= 21) return 'texto-alerta';
  return '';
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

  const [carga, seguir] = useEstadoCarga();
  const load = () => {
    callGetAlertasProximidad()
      .then(d => setAlertas(Array.isArray(d) ? d : []))
      .catch(err => { console.error(err); setAlertas([]); });
    seguir(api.getMaduracion().then(setPrimales));
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
    // Sin las bodegas v10 (12, 107, WC-01): su inventario va por etiqueta (services/bodegas.js).
    api.getBodegas().then(bs => setBodegas(soloLegacy(bs))).catch(aviso.errorCarga());
  }, []);

  useEffect(() => { loadTemperaturas(); }, [tempBodegaFilter]);

  const alertasProximidad = alertas.filter(a =>
    a.dias_restantes !== undefined && a.dias_restantes !== null && a.dias_restantes <= 5
  );

  const counts = { proximo: 0, urgente: 0, vencido: 0, olvidado: 0 };
  alertas.forEach(a => { if (counts[a.nivel] !== undefined) counts[a.nivel]++; });

  const bodegasPorcionado = bodegas.filter(b => b.tipo === 'porcionado');

  const enviarPorcionado = async (primal) => {
    if (bodegasPorcionado.length === 0) { aviso.error('No hay bodegas de porcionado configuradas. Un administrador debe crearlas en Bodegas.'); return; }
    const destino = bodegasPorcionado[0];
    if (!(await confirmar({ titulo: `¿Enviar ${primal.codigo} a porcionado?`, mensaje: `El primal pasará a la bodega ${destino.codigo}.`, textoConfirmar: 'Enviar' }))) return;
    try {
      await api.moverBodega({ primal_id: primal.id, bodega_destino_id: destino.id, tipo: 'salida_porcionado' });
      load();
    } catch (err) { aviso.error(err.message); }
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
    } catch (err) { aviso.error(err.message); }
  };

  const deleteTemp = async (id) => {
    if (!(await confirmar({ titulo: '¿Eliminar este registro de temperatura?', mensaje: 'Esta acción no se puede deshacer.', textoConfirmar: 'Eliminar', peligro: true }))) return;
    try {
      await callDeleteTemperatura(id);
      loadTemperaturas();
    } catch (err) { aviso.error(err.message); }
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
        <h2>Maduración</h2>
      </div>

      {alertasProximidad.length > 0 && (
        <div className="banner alerta" role="status">
          <Clock size={18} aria-hidden="true" />
          <div>
            <div className="banner-titulo">
              {alertasProximidad.length} {alertasProximidad.length === 1 ? 'primal próximo' : 'primales próximos'} a cumplir maduración (≤5 días)
            </div>
            <div className="chips">
              {alertasProximidad.map(a => (
                <span key={a.id} className="chip">
                  <strong>{a.codigo}</strong>
                  {a.numero_trazabilidad ? <span className="tenue">{a.numero_trazabilidad}</span> : null}
                  <strong>{a.dias_restantes} d</strong>
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {(counts.olvidado > 0 || counts.vencido > 0 || counts.urgente > 0) && (
        <div className={`banner ${counts.olvidado > 0 ? 'critico' : counts.vencido > 0 ? 'error' : 'alerta'}`} role="alert">
          <AlertTriangle size={18} aria-hidden="true" />
          <strong>
            {counts.olvidado > 0
              ? `${counts.olvidado} primales olvidados (más de 45 días sin movimiento): revisión urgente`
              : counts.vencido > 0
                ? `${counts.vencido} primales vencidos requieren acción inmediata`
                : `${counts.urgente} primales en estado urgente`}
          </strong>
        </div>
      )}

      <div className="card">
        <div className="card-header"><h3>Alertas de maduración</h3></div>
        <div className="niveles">
          <div className="nivel proximo">
            <div className="nivel-valor">{counts.proximo}</div>
            <span className="badge badge-green">Próximo (21-27 d)</span>
          </div>
          <div className="nivel urgente">
            <div className="nivel-valor">{counts.urgente}</div>
            <span className="badge badge-yellow">Urgente (28-29 d)</span>
          </div>
          <div className="nivel vencido">
            <div className="nivel-valor">{counts.vencido}</div>
            <span className="badge badge-red">Vencido (30-44 d)</span>
          </div>
          <div className="nivel olvidado">
            <div className="nivel-valor">{counts.olvidado}</div>
            <span className="badge badge-red">Olvidado (&gt;45 d)</span>
          </div>
        </div>

        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Código</th>
                <th>Animal</th>
                <th>Tipo</th>
                <th>Días</th>
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
                    <td><span className={diasClase(diasShown)}>{diasShown !== undefined && diasShown !== null ? `${diasShown} d` : '-'}</span></td>
                    <td>{nivelShown ? <span className={`badge ${nivelBadge[nivelShown] || 'badge-gray'}`}>{nivelShown}</span> : '-'}</td>
                  </tr>
                );
              })}
              <FilaEstado columnas={5} vacio={alertas.length === 0} tituloVacio="Sin alertas"
                textoVacio="Ningún primal está cerca de cumplir su maduración." />
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-header"><h3>Primales en maduración</h3></div>
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Código</th>
                <th>Animal</th>
                <th>Tipo</th>
                <th>Marmoleo</th>
                <th>Inicio</th>
                <th>Días</th>
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
                    <td><span className={`badge ${diasBadge(dias)}`}>{dias !== null ? `${dias} d` : '-'}</span></td>
                    <td>{p.bodega_codigo || '-'}</td>
                    <td>
                      <button type="button" className="btn-icon" onClick={() => enviarPorcionado(p)} title="Enviar a porcionado" aria-label={`Enviar ${p.codigo} a porcionado`}><Send size={16} aria-hidden="true" /></button>
                    </td>
                  </tr>
                );
              })}
              <FilaEstado columnas={8} cargando={carga.cargando} error={carga.error} onReintentar={load}
                vacio={primales.length === 0} tituloVacio="Sin primales en maduración"
                textoVacio="Los primales entran aquí desde Custodia." />
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3 className="rp-subtitulo"><Thermometer size={18} aria-hidden="true" /> Registro de temperatura</h3>
          <div className="card-herramientas">
            <label className="sr-only" htmlFor="filtro-bodega-temp">Bodega de maduración</label>
            <select id="filtro-bodega-temp" value={tempBodegaFilter} onChange={e => setTempBodegaFilter(e.target.value)}>
              <option value="">Todas las bodegas de maduración</option>
              {bodegasMaduracion.map(b => <option key={b.id} value={b.id}>{b.codigo} - {b.nombre}</option>)}
            </select>
            <button type="button" className="btn btn-primary" onClick={openTempModal}><Plus size={16} aria-hidden="true" /> Nuevo registro</button>
          </div>
        </div>

        {tempResumen && (
          <div className="banner info">
            <div>
              <strong>Período actual:</strong>{' '}
              {tempResumen.total ?? 0} registros,{' '}
              {tempResumen.pct_cumplimiento !== undefined && tempResumen.pct_cumplimiento !== null
                ? `${fmtNum(tempResumen.pct_cumplimiento, 1)}% de cumplimiento`
                : '-% de cumplimiento'}
              {tempResumen.min !== undefined && tempResumen.min !== null && (
                <>, mín. {fmtNum(tempResumen.min, 1)} °C</>
              )}
              {tempResumen.max !== undefined && tempResumen.max !== null && (
                <>, máx. {fmtNum(tempResumen.max, 1)} °C</>
              )}
              {tempResumen.avg !== undefined && tempResumen.avg !== null && (
                <>, promedio {fmtNum(tempResumen.avg, 1)} °C</>
              )}
            </div>
          </div>
        )}

        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Bodega</th>
                <th>Temperatura (°C)</th>
                <th>Cumple ≤4 °C</th>
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
                        ? <span className="badge badge-green">Cumple</span>
                        : <span className="badge badge-red">No cumple</span>}
                    </td>
                    <td>{t.responsable || '-'}</td>
                    <td className="celda-recortada" title={t.notas || ''}>{t.notas || '-'}</td>
                    <td>
                      <button type="button" className="btn-icon peligro" onClick={() => deleteTemp(t.id)} title="Eliminar registro" aria-label={`Eliminar registro de temperatura del ${formatDate(t.fecha)}`}><Trash2 size={16} aria-hidden="true" /></button>
                    </td>
                  </tr>
                );
              })}
              <FilaEstado columnas={7} vacio={temperaturas.length === 0} tituloVacio="Sin registros de temperatura"
                textoVacio="Anote la lectura diaria de la cámara con «Nuevo registro»." />
            </tbody>
          </table>
        </div>
      </div>

      {showTempModal && (
        <div className="modal-overlay" onClick={() => setShowTempModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Nuevo registro de temperatura</h3>
              <button type="button" className="btn-icon" aria-label="Cerrar" onClick={() => setShowTempModal(false)}><X size={20} aria-hidden="true" /></button>
            </div>
            <form onSubmit={submitTemp}>
              <div className="form-group">
                <label>Bodega *</label>
                <select required value={tempForm.bodega_id || ''} onChange={e => setTempForm({ ...tempForm, bodega_id: e.target.value })}>
                  <option value="">Seleccionar…</option>
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
