import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Bug as Cow, MapPin, Baby, Calendar, AlertTriangle } from 'lucide-react';
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

  const { resumen, porSexo, porRaza, porPotrero, pesajesRecientes, eventosProximos, gestacionesActivas } = data;

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
    </div>
  );
}
