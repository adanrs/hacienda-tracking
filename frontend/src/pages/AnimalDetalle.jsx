import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Weight, Heart, ArrowRightLeft, Baby, Clock } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { api } from '../services/api';
import { formatDate } from '../components/DateFormat';
import { CowWeightIndicator } from '../components/CowIcon';

const estadoBadge = { activo: 'badge-green', vendido: 'badge-blue', muerto: 'badge-red', trasladado: 'badge-yellow' };
const saludBadge = { vacunacion: 'badge-green', desparasitacion: 'badge-blue', tratamiento: 'badge-yellow', cirugia: 'badge-red', examen: 'badge-gray', otro: 'badge-gray' };
const timelineDotColor = { pesaje: '#16a34a', vacunacion: '#2563eb', movimiento: '#f59e0b', sacrificio: '#dc2626', corte: '#7c3aed', transporte: '#ea580c' };
const timelineBadgeClass = { pesaje: 'badge-green', vacunacion: 'badge-blue', movimiento: 'badge-yellow', sacrificio: 'badge-red', corte: 'badge-purple', transporte: 'badge-orange' };

export default function AnimalDetalle() {
  const { id } = useParams();
  const [animal, setAnimal] = useState(null);
  const [tab, setTab] = useState('pesajes');
  const [timeline, setTimeline] = useState([]);

  useEffect(() => {
    api.getAnimal(id).then(setAnimal).catch(console.error);
    api.getTimeline(id).then(setTimeline).catch(() => setTimeline([]));
  }, [id]);

  if (!animal) return <div className="empty-state">Cargando...</div>;

  const pesajesChart = [...(animal.pesajes || [])].reverse().map(p => ({ fecha: formatDate(p.fecha), peso: p.peso_kg }));

  return (
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link to="/animales" className="btn-icon"><ArrowLeft size={20} /></Link>
          <div>
            <h2>{animal.numero_trazabilidad} {animal.nombre && `- ${animal.nombre}`}</h2>
            <span className={`badge ${estadoBadge[animal.estado]}`}>{animal.estado}</span>
          </div>
        </div>
      </div>

      <div className="grid-3" style={{ marginBottom: 16 }}>
        <div className="card">
          <h4 style={{ marginBottom: 8, color: '#6b7280', fontSize: '0.85rem' }}>Informacion General</h4>
          <p><strong>Tipo:</strong> {animal.tipo}</p>
          <p><strong>Raza:</strong> {animal.raza || '-'}</p>
          <p><strong>Sexo:</strong> {animal.sexo}</p>
          <p><strong>Color:</strong> {animal.color || '-'}</p>
          <p><strong>Nacimiento:</strong> {formatDate(animal.fecha_nacimiento)}</p>
        </div>
        <div className="card">
          <h4 style={{ marginBottom: 8, color: '#6b7280', fontSize: '0.85rem' }}>Peso y Desarrollo</h4>
          <CowWeightIndicator
            pesoNacimiento={animal.peso_nacimiento}
            pesoActual={animal.peso_actual}
            pesoObjetivo={500}
          />
          <div style={{ marginTop: 12, padding: '8px 12px', background: '#f0fdf4', borderRadius: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
              <span>Peso actual:</span>
              <strong style={{ color: '#16a34a', fontSize: '1.1rem' }}>{animal.peso_actual ? `${animal.peso_actual} kg` : 'Sin registro'}</strong>
            </div>
          </div>
        </div>
        <div className="card">
          <h4 style={{ marginBottom: 8, color: '#6b7280', fontSize: '0.85rem' }}>Ubicacion y Genealogia</h4>
          <p><strong>Potrero:</strong> {animal.potrero_nombre || 'Sin asignar'}</p>
          <p><strong>Madre:</strong> {animal.madre_trazabilidad ? <Link to={`/animales/${animal.madre_id}`}>{animal.madre_trazabilidad} {animal.madre_nombre && `(${animal.madre_nombre})`}</Link> : '-'}</p>
          <p><strong>Padre:</strong> {animal.padre_trazabilidad ? <Link to={`/animales/${animal.padre_id}`}>{animal.padre_trazabilidad} {animal.padre_nombre && `(${animal.padre_nombre})`}</Link> : '-'}</p>
          <p><strong>Crias:</strong> {animal.crias?.length || 0}</p>
          {animal.notas && <p style={{ marginTop: 8, fontSize: '0.85rem', color: '#6b7280' }}><strong>Notas:</strong> {animal.notas}</p>}
        </div>
      </div>

      {pesajesChart.length > 1 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginBottom: 12 }}>Curva de Peso</h3>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={pesajesChart}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="fecha" fontSize={11} />
              <YAxis unit=" kg" fontSize={11} />
              <Tooltip formatter={(val) => [`${val} kg`, 'Peso']} />
              <Line type="monotone" dataKey="peso" stroke="#16a34a" strokeWidth={2} dot={{ r: 4, fill: '#16a34a' }} activeDot={{ r: 6, fill: '#15803d' }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="tabs">
        <div className={`tab ${tab === 'pesajes' ? 'active' : ''}`} onClick={() => setTab('pesajes')}><Weight size={14} style={{ marginRight: 4 }} />Pesajes ({animal.pesajes?.length || 0})</div>
        <div className={`tab ${tab === 'salud' ? 'active' : ''}`} onClick={() => setTab('salud')}><Heart size={14} style={{ marginRight: 4 }} />Salud ({animal.salud?.length || 0})</div>
        <div className={`tab ${tab === 'movimientos' ? 'active' : ''}`} onClick={() => setTab('movimientos')}><ArrowRightLeft size={14} style={{ marginRight: 4 }} />Movimientos ({animal.movimientos?.length || 0})</div>
        <div className={`tab ${tab === 'crias' ? 'active' : ''}`} onClick={() => setTab('crias')}><Baby size={14} style={{ marginRight: 4 }} />Crias ({animal.crias?.length || 0})</div>
        <div className={`tab ${tab === 'timeline' ? 'active' : ''}`} onClick={() => setTab('timeline')}><Clock size={14} style={{ marginRight: 4 }} />Timeline ({timeline.length})</div>
      </div>

      <div className="card">
        {tab === 'pesajes' && (
          <table>
            <thead><tr><th>Fecha</th><th>Peso (kg)</th><th>Tipo</th><th>Notas</th></tr></thead>
            <tbody>
              {(animal.pesajes || []).map(p => (
                <tr key={p.id}><td>{formatDate(p.fecha)}</td><td><strong>{p.peso_kg}</strong></td><td><span className="badge badge-green">{p.tipo}</span></td><td>{p.notas || '-'}</td></tr>
              ))}
              {!animal.pesajes?.length && <tr><td colSpan={4} className="empty-state">Sin pesajes</td></tr>}
            </tbody>
          </table>
        )}
        {tab === 'salud' && (
          <table>
            <thead><tr><th>Fecha</th><th>Tipo</th><th>Descripcion</th><th>Producto</th><th>Veterinario</th><th>Proxima</th></tr></thead>
            <tbody>
              {(animal.salud || []).map(e => (
                <tr key={e.id}><td>{formatDate(e.fecha)}</td><td><span className={`badge ${saludBadge[e.tipo]}`}>{e.tipo}</span></td><td>{e.descripcion}</td><td>{e.producto || '-'}</td><td>{e.veterinario || '-'}</td><td>{formatDate(e.proxima_fecha)}</td></tr>
              ))}
              {!animal.salud?.length && <tr><td colSpan={6} className="empty-state">Sin eventos de salud</td></tr>}
            </tbody>
          </table>
        )}
        {tab === 'movimientos' && (
          <table>
            <thead><tr><th>Fecha</th><th>Origen</th><th>Destino</th><th>Motivo</th><th>Responsable</th></tr></thead>
            <tbody>
              {(animal.movimientos || []).map(m => (
                <tr key={m.id}><td>{formatDate(m.fecha)}</td><td>{m.origen_nombre || '-'}</td><td>{m.destino_nombre || '-'}</td><td>{m.motivo || '-'}</td><td>{m.responsable || '-'}</td></tr>
              ))}
              {!animal.movimientos?.length && <tr><td colSpan={5} className="empty-state">Sin movimientos</td></tr>}
            </tbody>
          </table>
        )}
        {tab === 'crias' && (
          <table>
            <thead><tr><th>No. Trazabilidad</th><th>Nombre</th><th>Sexo</th><th>Nacimiento</th></tr></thead>
            <tbody>
              {(animal.crias || []).map(c => (
                <tr key={c.id}><td><Link to={`/animales/${c.id}`}>{c.numero_trazabilidad}</Link></td><td>{c.nombre || '-'}</td><td>{c.sexo}</td><td>{formatDate(c.fecha_nacimiento)}</td></tr>
              ))}
              {!animal.crias?.length && <tr><td colSpan={4} className="empty-state">Sin crias registradas</td></tr>}
            </tbody>
          </table>
        )}
        {tab === 'timeline' && (
          timeline.length > 0 ? (
            <div className="timeline">
              {timeline.map((ev, i) => (
                <div key={i} className="timeline-item">
                  <div className="timeline-dot" style={{ background: timelineDotColor[ev.tipo] || '#9ca3af', boxShadow: `0 0 0 2px ${timelineDotColor[ev.tipo] || '#9ca3af'}` }} />
                  <div className="timeline-content">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <span className={`badge ${timelineBadgeClass[ev.tipo] || 'badge-gray'}`}>{ev.tipo}</span>
                      <span className="timeline-date">{formatDate(ev.fecha)}</span>
                    </div>
                    <div style={{ fontSize: '0.875rem' }}>{ev.descripcion}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">Sin eventos en el timeline</div>
          )
        )}
      </div>
    </div>
  );
}
