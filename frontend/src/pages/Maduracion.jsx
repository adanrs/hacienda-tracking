import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Send } from 'lucide-react';
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

export default function Maduracion() {
  const [alertas, setAlertas] = useState([]);
  const [primales, setPrimales] = useState([]);
  const [bodegas, setBodegas] = useState([]);

  const load = () => {
    api.getAlertasMaduracion().then(setAlertas).catch(console.error);
    api.getMaduracion().then(setPrimales).catch(console.error);
  };

  useEffect(() => {
    load();
    api.getBodegas().then(setBodegas).catch(console.error);
  }, []);

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

  return (
    <div>
      <div className="page-header">
        <h2>Maduracion</h2>
      </div>

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
              {alertas.map(a => (
                <tr key={a.id}>
                  <td><strong>{a.codigo}</strong></td>
                  <td>{a.numero_trazabilidad || '-'}</td>
                  <td>{a.tipo_primal}</td>
                  <td><span style={{ fontSize: '1.15rem', fontWeight: 700, color: diasColor(a.dias_maduracion) }}>{a.dias_maduracion}d</span></td>
                  <td><span className={`badge ${nivelBadge[a.nivel] || 'badge-gray'}`}>{a.nivel}</span></td>
                </tr>
              ))}
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
    </div>
  );
}
