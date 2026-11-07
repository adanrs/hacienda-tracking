import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Weight, Heart, ArrowRightLeft, Baby, Clock } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { api } from '../services/api';
import { Cargando, EstadoError } from '../components/ui/Estados';
import { formatDate } from '../components/DateFormat';
import { CowWeightIndicator } from '../components/CowIcon';

const estadoBadge = { activo: 'badge-green', vendido: 'badge-blue', muerto: 'badge-red', trasladado: 'badge-yellow' };
const saludBadge = { vacunacion: 'badge-green', desparasitacion: 'badge-blue', tratamiento: 'badge-yellow', cirugia: 'badge-red', examen: 'badge-gray', otro: 'badge-gray' };
// Colores de gráfico alineados con los tokens de index.css (recharts necesita valores, no var()).
const MARCA = '#b8184a';
const EJE = { texto: '#5f5f5c', linea: '#8e8e89', grilla: '#ececea' };
const timelineBadgeClass = { pesaje: 'badge-green', vacunacion: 'badge-blue', movimiento: 'badge-yellow', sacrificio: 'badge-red', corte: 'badge-purple', transporte: 'badge-orange', deshuese: 'badge-blue', primal: 'badge-blue', custodia: 'badge-gray', maduracion: 'badge-yellow', porcionado: 'badge-purple', sticker: 'badge-gray', guia_movilizacion: 'badge-orange', custodia_ciisa: 'badge-gray' };

export default function AnimalDetalle() {
  const { id } = useParams();
  const [animal, setAnimal] = useState(null);
  const [tab, setTab] = useState('pesajes');
  const [timeline, setTimeline] = useState([]);
  const [error, setError] = useState(null);

  const cargar = () => {
    setError(null);
    setAnimal(null);
    api.getAnimal(id).then(setAnimal).catch(err => setError(err.message));
    // La API responde { animal, timeline }: se toma la lista (antes se guardaba el objeto entero
    // y la pestaña «Línea de tiempo» quedaba siempre vacía).
    api.getTimeline(id)
      .then(r => setTimeline(Array.isArray(r) ? r : (Array.isArray(r?.timeline) ? r.timeline : [])))
      .catch(() => setTimeline([]));
  };

  useEffect(() => { cargar(); }, [id]);

  // Antes, si la carga fallaba, la pantalla quedaba en «Cargando...» para siempre.
  if (error) return (
    <div>
      <Link to="/animales" className="btn btn-secondary"><ArrowLeft size={16} aria-hidden="true" /> Volver a Animales</Link>
      <EstadoError titulo="No se pudo cargar la ficha del animal" mensaje={error} onReintentar={cargar} />
    </div>
  );
  if (!animal) return <Cargando texto="Cargando la ficha del animal…" />;

  const pesajesChart = [...(animal.pesajes || [])].reverse().map(p => ({ fecha: formatDate(p.fecha), peso: Number(p.peso_kg) }));

  return (
    <div>
      <div className="page-header">
        <div className="encabezado-ficha">
          <Link to="/animales" className="btn-icon" aria-label="Volver a Animales" title="Volver a Animales"><ArrowLeft size={20} aria-hidden="true" /></Link>
          <div>
            <h2>{animal.numero_trazabilidad} {animal.nombre && `· ${animal.nombre}`}</h2>
            <span className={`badge ${estadoBadge[animal.estado] || 'badge-gray'}`}>{animal.estado}</span>
          </div>
        </div>
      </div>

      <div className="grid-3">
        <div className="card">
          <h3 className="ficha-titulo">Información general</h3>
          <dl className="ficha-datos">
            <dt>Tipo</dt><dd>{animal.tipo || '-'}</dd>
            <dt>Raza</dt><dd>{animal.raza || '-'}</dd>
            <dt>Sexo</dt><dd>{animal.sexo || '-'}</dd>
            <dt>Color</dt><dd>{animal.color || '-'}</dd>
            <dt>Nacimiento</dt><dd>{formatDate(animal.fecha_nacimiento)}</dd>
          </dl>
        </div>
        <div className="card">
          <h3 className="ficha-titulo">Peso y desarrollo</h3>
          <CowWeightIndicator
            pesoNacimiento={animal.peso_nacimiento}
            pesoActual={animal.peso_actual}
            pesoObjetivo={500}
          />
          <div className="ficha-peso">
            <span>Peso actual</span>
            <strong>{animal.peso_actual ? `${animal.peso_actual} kg` : 'Sin registro'}</strong>
          </div>
        </div>
        <div className="card">
          <h3 className="ficha-titulo">Ubicación y genealogía</h3>
          <dl className="ficha-datos">
            <dt>Potrero</dt><dd>{animal.potrero_nombre || 'Sin asignar'}</dd>
            <dt>Madre</dt><dd>{animal.madre_trazabilidad ? <Link to={`/animales/${animal.madre_id}`}>{animal.madre_trazabilidad} {animal.madre_nombre && `(${animal.madre_nombre})`}</Link> : '-'}</dd>
            <dt>Padre</dt><dd>{animal.padre_trazabilidad ? <Link to={`/animales/${animal.padre_id}`}>{animal.padre_trazabilidad} {animal.padre_nombre && `(${animal.padre_nombre})`}</Link> : '-'}</dd>
            <dt>Crías</dt><dd>{animal.crias?.length || 0}</dd>
          </dl>
          {animal.notas && <p className="ficha-nota"><strong>Notas:</strong> {animal.notas}</p>}
        </div>
      </div>

      {pesajesChart.length > 1 && (
        <div className="card">
          <div className="card-header"><h3>Curva de peso</h3></div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={pesajesChart} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={EJE.grilla} />
              <XAxis dataKey="fecha" fontSize={12} tick={{ fill: EJE.texto }} tickLine={false} axisLine={{ stroke: EJE.linea }} />
              <YAxis unit=" kg" fontSize={12} tick={{ fill: EJE.texto }} tickLine={false} axisLine={false} width={64} domain={[0, 'auto']} />
              <Tooltip formatter={(val) => [`${val} kg`, 'Peso']} />
              <Line type="monotone" dataKey="peso" stroke={MARCA} strokeWidth={2} dot={{ r: 4, fill: MARCA }} activeDot={{ r: 6, fill: MARCA }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {(animal.guias_movilizacion?.length > 0 || animal.documentos_custodia?.length > 0) && (
        // Documentos del MAG y de la planta donde aparece el animal (guía por DIIO; ASE/TRE por Lote CC / RES).
        <div className="card">
          <div className="card-header"><h3>Documentos</h3></div>
          <ul className="lista-documentos">
            {(animal.guias_movilizacion || []).map(g => (
              <li key={`g${g.id}`}>
                <Link to={`/guias-movilizacion/${g.id}`}><strong>Guía de movilización MAG {g.numero}</strong></Link>
                {' · '}{formatDate(g.fecha)} · DIIO <code>{g.diio}</code>{g.destino_establecimiento ? ` · a ${g.destino_establecimiento}` : ''}
                {g.vinculo === 'manual' && <span className="rp-tenue"> · ligado a mano</span>}
              </li>
            ))}
            {(animal.documentos_custodia || []).map(d => (
              <li key={`d${d.id}`}>
                <Link to={`/documentos-custodia/${d.id}`}><strong>{d.tipo === 'traslado' ? `Traslado de custodia TRE ${d.numero}` : `Ajuste de salida ASE ${d.numero}`}</strong></Link>
                {' · '}{formatDate(d.fecha)}{d.bodega_destino_nombre ? ` · a ${d.bodega_destino_nombre}` : ''}
                {d.total_kg != null ? ` · ${Number(d.total_kg).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg` : ''}
                {d.vinculo === 'manual' && <span className="rp-tenue"> · ligado a mano</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="tabs" role="tablist" aria-label="Historial del animal">
        <button type="button" role="tab" aria-selected={tab === 'pesajes'} className={`tab ${tab === 'pesajes' ? 'active' : ''}`} onClick={() => setTab('pesajes')}><Weight size={14} aria-hidden="true" />Pesajes ({animal.pesajes?.length || 0})</button>
        <button type="button" role="tab" aria-selected={tab === 'salud'} className={`tab ${tab === 'salud' ? 'active' : ''}`} onClick={() => setTab('salud')}><Heart size={14} aria-hidden="true" />Salud ({animal.salud?.length || 0})</button>
        <button type="button" role="tab" aria-selected={tab === 'movimientos'} className={`tab ${tab === 'movimientos' ? 'active' : ''}`} onClick={() => setTab('movimientos')}><ArrowRightLeft size={14} aria-hidden="true" />Movimientos ({animal.movimientos?.length || 0})</button>
        <button type="button" role="tab" aria-selected={tab === 'crias'} className={`tab ${tab === 'crias' ? 'active' : ''}`} onClick={() => setTab('crias')}><Baby size={14} aria-hidden="true" />Crías ({animal.crias?.length || 0})</button>
        <button type="button" role="tab" aria-selected={tab === 'timeline'} className={`tab ${tab === 'timeline' ? 'active' : ''}`} onClick={() => setTab('timeline')}><Clock size={14} aria-hidden="true" />Línea de tiempo ({timeline.length})</button>
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
            <thead><tr><th>Fecha</th><th>Tipo</th><th>Descripción</th><th>Producto</th><th>Veterinario</th><th>Próxima</th></tr></thead>
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
            <thead><tr><th>N.º de trazabilidad</th><th>Nombre</th><th>Sexo</th><th>Nacimiento</th></tr></thead>
            <tbody>
              {(animal.crias || []).map(c => (
                <tr key={c.id}><td><Link to={`/animales/${c.id}`}>{c.numero_trazabilidad}</Link></td><td>{c.nombre || '-'}</td><td>{c.sexo}</td><td>{formatDate(c.fecha_nacimiento)}</td></tr>
              ))}
              {!animal.crias?.length && <tr><td colSpan={4} className="empty-state">Sin crías registradas</td></tr>}
            </tbody>
          </table>
        )}
        {tab === 'timeline' && (
          timeline.length > 0 ? (
            <div className="timeline">
              {timeline.map((ev, i) => (
                <div key={i} className="timeline-item">
                  <div className="timeline-dot" aria-hidden="true" />
                  <div className="timeline-content">
                    <div className="timeline-encabezado">
                      <span className={`badge ${timelineBadgeClass[ev.tipo] || 'badge-gray'}`}>{ev.tipo}</span>
                      <span className="timeline-date">{formatDate(ev.fecha)}</span>
                    </div>
                    <div className="timeline-texto">{ev.descripcion}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">Sin eventos en la línea de tiempo</div>
          )
        )}
      </div>
    </div>
  );
}
