import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Bug as Cow, MapPin, Baby, Calendar, AlertTriangle, Clock, Package, FileOutput, RotateCcw } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { api } from '../services/api';
import { formatDate } from '../components/DateFormat';
import { CowWalking } from '../components/CowIcon';

const COLORS = ['#16a34a', '#2563eb', '#f59e0b', '#dc2626', '#8b5cf6', '#ec4899', '#06b6d4'];

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getDashboard().then(setData).catch(console.error).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="empty-state"><CowWalking size={64} /><p style={{ marginTop: 12 }}>Cargando dashboard...</p></div>;
  if (!data) return <div className="empty-state">Error al cargar datos</div>;

  const { resumen, porSexo, porRaza, porPotrero, pesajesRecientes, eventosProximos, gestacionesActivas, topGDP, maduracionAlertas = [] } = data;
  const vencidos = maduracionAlertas.filter(m => m.nivel === 'vencido');
  const urgentes = maduracionAlertas.filter(m => m.nivel === 'urgente');

  return (
    <div>
      <div className="page-header">
        <h2>Dashboard</h2>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon green"><Cow size={24} /></div>
          <div>
            <div className="stat-value">{resumen.totalAnimales}</div>
            <div className="stat-label">Animales Activos</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon blue"><MapPin size={24} /></div>
          <div>
            <div className="stat-value">{resumen.totalPotreros}</div>
            <div className="stat-label">Potreros Activos</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon yellow"><Baby size={24} /></div>
          <div>
            <div className="stat-value">{resumen.gestacionesActivas}</div>
            <div className="stat-label">Gestaciones Activas</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon red"><Calendar size={24} /></div>
          <div>
            <div className="stat-value">{resumen.nacimientosMes}</div>
            <div className="stat-label">Nacimientos este Mes</div>
          </div>
        </div>
      </div>

      <div className="stats-grid" style={{ marginTop: 16 }}>
        <Link to="/custodia" className="stat-card" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="stat-icon blue"><Package size={24} /></div>
          <div>
            <div className="stat-value">{resumen.primalesEnCustodia ?? 0}</div>
            <div className="stat-label">Primales en Custodia</div>
          </div>
        </Link>
        <Link to="/maduracion" className="stat-card" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="stat-icon yellow"><Clock size={24} /></div>
          <div>
            <div className="stat-value" style={{ color: vencidos.length > 0 ? '#dc2626' : undefined }}>{resumen.maduracionAlertasCount ?? 0}</div>
            <div className="stat-label">Alertas Maduracion</div>
          </div>
        </Link>
        <Link to="/ordenes-salida" className="stat-card" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="stat-icon green"><FileOutput size={24} /></div>
          <div>
            <div className="stat-value">{resumen.ordenesPendientes ?? 0}</div>
            <div className="stat-label">Ordenes Pendientes</div>
          </div>
        </Link>
        <Link to="/devoluciones" className="stat-card" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="stat-icon red"><RotateCcw size={24} /></div>
          <div>
            <div className="stat-value">{resumen.devolucionesSinReprocesar ?? 0}</div>
            <div className="stat-label">Devoluciones Sin Reprocesar</div>
          </div>
        </Link>
      </div>

      {maduracionAlertas.length > 0 && (
        <div className="card" style={{ marginTop: 16, borderLeft: `4px solid ${vencidos.length ? '#dc2626' : urgentes.length ? '#f59e0b' : '#eab308'}` }}>
          <div className="card-header">
            <h3>
              <AlertTriangle size={18} color={vencidos.length ? '#dc2626' : '#f59e0b'} style={{ verticalAlign: 'middle', marginRight: 6 }} />
              Alertas de Maduracion ({maduracionAlertas.length})
            </h3>
            <Link to="/maduracion" style={{ fontSize: '0.85rem' }}>Ver todos</Link>
          </div>
          <div className="table-container">
            <table>
              <thead>
                <tr><th>Codigo</th><th>Animal</th><th>Tipo</th><th>Marmoleo</th><th>Dias</th><th>Nivel</th></tr>
              </thead>
              <tbody>
                {maduracionAlertas.slice(0, 10).map(m => {
                  const nivelBadge = m.nivel === 'vencido' ? 'badge-red' : m.nivel === 'urgente' ? 'badge-yellow' : 'badge-blue';
                  return (
                    <tr key={m.id}>
                      <td><code>{m.codigo}</code></td>
                      <td><Link to={`/animales/${m.animal_id || ''}`}>{m.numero_trazabilidad}</Link></td>
                      <td>{m.tipo_primal}</td>
                      <td>{m.marmoleo ? `BMS ${m.marmoleo}` : '-'}</td>
                      <td><strong style={{ color: m.nivel === 'vencido' ? '#dc2626' : m.nivel === 'urgente' ? '#f59e0b' : '#0ea5e9' }}>{m.dias_maduracion}</strong></td>
                      <td><span className={`badge ${nivelBadge}`}>{m.nivel}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid-2">
        <div className="card">
          <div className="card-header"><h3>Animales por Potrero</h3></div>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={porPotrero}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="nombre" fontSize={12} />
              <YAxis />
              <Tooltip />
              <Bar dataKey="total" fill="#16a34a" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="card">
          <div className="card-header"><h3>Distribucion por Raza</h3></div>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie data={porRaza} dataKey="total" nameKey="raza" cx="50%" cy="50%" outerRadius={90} label={({ raza, total }) => `${raza} (${total})`}>
                {porRaza.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid-2" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="card-header"><h3>Pesajes Recientes</h3></div>
          <div className="table-container">
            <table>
              <thead><tr><th>Animal</th><th>Peso (kg)</th><th>Fecha</th></tr></thead>
              <tbody>
                {pesajesRecientes.map(p => (
                  <tr key={p.id}>
                    <td><Link to={`/animales/${p.animal_id}`}>{p.numero_trazabilidad}</Link></td>
                    <td><strong>{p.peso_kg}</strong></td>
                    <td>{formatDate(p.fecha)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <div className="card-header">
            <h3>Proximos Eventos de Salud</h3>
            <AlertTriangle size={18} color="#f59e0b" />
          </div>
          <div className="table-container">
            <table>
              <thead><tr><th>Animal</th><th>Evento</th><th>Fecha</th></tr></thead>
              <tbody>
                {eventosProximos.map(e => (
                  <tr key={e.id}>
                    <td><Link to={`/animales/${e.animal_id}`}>{e.numero_trazabilidad}</Link></td>
                    <td><span className="badge badge-yellow">{e.tipo}</span></td>
                    <td>{formatDate(e.proxima_fecha)}</td>
                  </tr>
                ))}
                {eventosProximos.length === 0 && <tr><td colSpan={3} style={{ textAlign: 'center', color: '#9ca3af' }}>Sin eventos proximos</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {topGDP && topGDP.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-header"><h3>Top GDP (Ganancia Diaria de Peso)</h3></div>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Animal</th>
                  <th>Peso Nacimiento (kg)</th>
                  <th>Peso Actual (kg)</th>
                  <th>Dias</th>
                  <th>GDP (kg/dia)</th>
                </tr>
              </thead>
              <tbody>
                {topGDP.map((g, i) => {
                  const gdp = parseFloat(g.gdp) || 0;
                  const gdpClass = gdp > 0.8 ? 'gdp-good' : gdp >= 0.5 ? 'gdp-mid' : 'gdp-low';
                  return (
                    <tr key={i}>
                      <td><Link to={`/animales/${g.id}`}>{g.numero_trazabilidad} {g.nombre && `(${g.nombre})`}</Link></td>
                      <td>{g.peso_nacimiento || '-'}</td>
                      <td>{g.peso_actual || '-'}</td>
                      <td>{g.dias_vida || '-'}</td>
                      <td><span className={gdpClass}>{gdp ? gdp.toFixed(3) : '-'}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
