import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Beef as Cow, MapPin, Baby, Calendar, AlertTriangle, Clock, Package, FileOutput, FileInput, RotateCcw, Utensils } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { api } from '../services/api';
import { formatDate } from '../components/DateFormat';
import { Cargando, EstadoError } from '../components/ui/Estados';

// Colores de gráficos alineados con los tokens de index.css (Recharts necesita valores, no var()).
const MARCA = '#b8184a';
const TINTA = '#474745';
const EJE = { texto: '#5f5f5c', linea: '#8e8e89', grilla: '#ececea', cursor: 'rgba(22, 22, 22, 0.05)' };

// Indicador enlazado a su pantalla. Si pide atención, la tarjeta se marca y una línea de texto lo
// dice (no solo el color).
function Kpi({ to, icono: Icono, valor, etiqueta, alerta = false, aviso }) {
  return (
    <Link to={to} className={`stat-card ${alerta ? 'alerta' : ''}`}>
      <div className="stat-icon"><Icono size={24} aria-hidden="true" /></div>
      <div>
        <div className="stat-value">{valor ?? 0}</div>
        <div className="stat-label">{etiqueta}</div>
        {alerta && aviso && <div className="stat-aviso">{aviso}</div>}
      </div>
    </Link>
  );
}

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const cargar = () => {
    setLoading(true);
    setError(null);
    api.getDashboard()
      .then(setData)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { cargar(); }, []);

  if (loading) return <Cargando texto="Cargando el resumen…" />;
  if (error || !data) return <EstadoError titulo="No se pudo cargar el resumen" mensaje={error} onReintentar={cargar} />;

  const { resumen, porSexo, porRaza, porPotrero, pesajesRecientes, eventosProximos, gestacionesActivas, topGDP, maduracionAlertas = [] } = data;
  const razasOrdenadas = [...(porRaza || [])].sort((a, b) => b.total - a.total);
  const olvidados = maduracionAlertas.filter(m => m.nivel === 'olvidado');
  const vencidos = maduracionAlertas.filter(m => m.nivel === 'vencido');
  const urgentes = maduracionAlertas.filter(m => m.nivel === 'urgente');

  return (
    <div>
      <div className="page-header">
        <h2>Resumen general</h2>
      </div>

      {/* Los indicadores van agrupados por etapa, en el mismo orden que el menú (Finca → Planta y
          bodega), para que cada número se lea con su contexto y no como una grilla de 11 iguales. */}
      <section className="seccion" aria-labelledby="resumen-finca">
        <h3 className="seccion-titulo" id="resumen-finca">Finca</h3>
        <div className="stats-grid">
          <Kpi to="/animales" icono={Cow} valor={resumen.totalAnimales} etiqueta="Animales activos" />
          <Kpi to="/potreros" icono={MapPin} valor={resumen.totalPotreros} etiqueta="Potreros activos" />
          <Kpi to="/reproduccion" icono={Baby} valor={resumen.gestacionesActivas} etiqueta="Gestaciones activas" />
          <Kpi to="/reproduccion" icono={Calendar} valor={resumen.nacimientosMes} etiqueta="Nacimientos este mes" />
        </div>
      </section>

      <section className="seccion" aria-labelledby="resumen-planta">
        <h3 className="seccion-titulo" id="resumen-planta">Planta y bodega</h3>
        <div className="stats-grid">
          <Kpi to="/maduracion" icono={AlertTriangle} valor={resumen.olvidadosCount ?? 0} etiqueta="Primales olvidados (más de 45 d)"
            alerta={olvidados.length > 0} aviso="Revisar hoy" />
          <Kpi to="/maduracion" icono={Clock} valor={resumen.maduracionAlertasCount ?? 0} etiqueta="Alertas de maduración"
            alerta={vencidos.length > 0} aviso="Hay primales vencidos" />
          <Kpi to="/custodia" icono={Package} valor={resumen.primalesEnCustodia ?? 0} etiqueta="Primales en custodia" />
          <Kpi to="/paqueteria" icono={Utensils} valor={resumen.paqueteriaEnProceso ?? 0} etiqueta="Paquetería en proceso" />
          <Kpi to="/ordenes-entrada" icono={FileInput} valor={resumen.ordenesEntradaPendientes ?? 0} etiqueta="Órdenes de entrada pendientes" />
          <Kpi to="/ordenes-salida" icono={FileOutput} valor={resumen.ordenesPendientes ?? 0} etiqueta="Órdenes de salida pendientes" />
          <Kpi to="/devoluciones" icono={RotateCcw} valor={resumen.devolucionesSinReprocesar ?? 0} etiqueta="Devoluciones sin reprocesar" />
        </div>

        {maduracionAlertas.length > 0 && (
          <div className={`card ${vencidos.length || urgentes.length ? 'card-alerta' : ''}`}>
            <div className="card-header">
              <h3 className="rp-subtitulo">
                <AlertTriangle size={18} aria-hidden="true" className={vencidos.length ? 'texto-error' : 'texto-alerta'} />
                Alertas de maduración ({maduracionAlertas.length})
              </h3>
              <Link to="/maduracion">Ver todas</Link>
            </div>
            <div className="table-container">
              <table>
                <thead>
                  <tr><th>Código</th><th>Animal</th><th>Tipo</th><th>Marmoleo</th><th>Días</th><th>Nivel</th></tr>
                </thead>
                <tbody>
                  {maduracionAlertas.slice(0, 10).map(m => {
                    const nivelBadge = m.nivel === 'vencido' || m.nivel === 'olvidado' ? 'badge-red' : m.nivel === 'urgente' ? 'badge-yellow' : 'badge-blue';
                    const diasClase = m.nivel === 'vencido' || m.nivel === 'olvidado' ? 'texto-error' : m.nivel === 'urgente' ? 'texto-alerta' : '';
                    return (
                      <tr key={m.id}>
                        <td><code>{m.codigo}</code></td>
                        <td><Link to={`/animales/${m.animal_id || ''}`}>{m.numero_trazabilidad}</Link></td>
                        <td>{m.tipo_primal}</td>
                        <td>{m.marmoleo ? `BMS ${m.marmoleo}` : '-'}</td>
                        <td><strong className={diasClase}>{m.dias_maduracion}</strong></td>
                        <td><span className={`badge ${nivelBadge}`}>{m.nivel}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <section className="seccion" aria-labelledby="resumen-hato">
        <h3 className="seccion-titulo" id="resumen-hato">Hato</h3>
      <div className="grid-2">
        <div className="card">
          <div className="card-header"><h3>Animales por potrero</h3></div>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={porPotrero} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={EJE.grilla} />
              {/* interval={0}: mostrar todos los potreros; recharts escondía los que no cabían. */}
              <XAxis dataKey="nombre" fontSize={12} tick={{ fill: EJE.texto }} tickLine={false} axisLine={{ stroke: EJE.linea }} interval={0} />
              <YAxis allowDecimals={false} fontSize={12} tick={{ fill: EJE.texto }} tickLine={false} axisLine={false} />
              <Tooltip cursor={{ fill: EJE.cursor }} />
              <Bar dataKey="total" name="Animales" fill={MARCA} radius={[3, 3, 0, 0]} maxBarSize={56} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="card">
          <div className="card-header"><h3>Distribución por raza</h3></div>
          <ResponsiveContainer width="100%" height={250}>
            {/* Barras horizontales ordenadas en vez de torta: con 7 razas la torta obliga a
                comparar ángulos y colores; aquí se lee el largo y el número. */}
            <BarChart data={razasOrdenadas} layout="vertical" margin={{ top: 0, right: 32, left: 8, bottom: 0 }}>
              <XAxis type="number" hide allowDecimals={false} />
              <YAxis type="category" dataKey="raza" width={96} fontSize={13} tick={{ fill: EJE.texto }} tickLine={false} axisLine={false} />
              <Tooltip cursor={{ fill: EJE.cursor }} />
              <Bar dataKey="total" name="Animales" fill={TINTA} radius={[0, 3, 3, 0]} maxBarSize={22}
                label={{ position: 'right', fill: EJE.texto, fontSize: 12 }} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-header"><h3>Pesajes recientes</h3></div>
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
            <h3>Próximos eventos de salud</h3>
            <AlertTriangle size={18} aria-hidden="true" className="texto-alerta" />
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
                {eventosProximos.length === 0 && <tr><td colSpan={3} className="empty-state">Sin eventos de salud en los próximos días</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {topGDP && topGDP.length > 0 && (
        <div className="card">
          <div className="card-header"><h3>Mejor GDP (ganancia diaria de peso)</h3></div>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Animal</th>
                  <th>Peso al nacer (kg)</th>
                  <th>Peso actual (kg)</th>
                  <th>Días</th>
                  <th>GDP (kg/día)</th>
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
      </section>
    </div>
  );
}
