import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { FileCheck2, ArrowLeft, CircleAlert, Truck } from 'lucide-react';
import { api } from '../services/api';
import { Cargando, EstadoError, EstadoVacio } from '../components/ui/Estados';
import { useAuth } from '../components/AuthContext';
import ImportadorDocumentos from '../components/importador/ImportadorDocumentos';
import LigarAnimal from '../components/importador/LigarAnimal';

/*
  Guías de movilización del MAG/SENASA (formulario FTZ-02): la guía oficial con la que los animales
  salen de la finca a la planta. Se cargan con el PDF del SENASA, un Word, una foto o el texto, pasan
  por la vista previa y quedan guardadas con cada bovino y su DIIO. El DIIO se liga al animal por su
  I.E. de Ganadero SG; lo que no calza queda «sin animal» y se liga a mano en el detalle (nunca se
  adivina). Si los animales salieron en una guía de transporte de la app ese día, esa guía recibe el
  número oficial.
*/
const fechaCorta = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—');
const SEXO = { H: 'Hembra', M: 'Macho', MC: 'Macho castrado' };

const COLUMNAS = [
  { titulo: 'Guía', valor: f => f.guia || '—' },
  { titulo: 'DIIO', valor: f => <code>{f.diio || '—'}</code> },
  { titulo: 'Sexo', valor: f => SEXO[f.sexo] || '—' },
  { titulo: 'Raza', valor: f => f.raza || '—' },
  { titulo: 'Animal', valor: f => (f.arete ? <strong>{f.arete}</strong> : <span className="badge badge-yellow">Sin animal</span>) },
];

const ACCION = { nuevo: ['Se crea', 'badge-green'], actualizar: ['Se actualiza', 'badge-blue'], sin_cambios: ['Sin cambios', 'badge-gray'], error: ['Con error', 'badge-red'] };

function EncabezadosGuias({ plan }) {
  if (!plan.guias?.length) return null;
  return (
    <div className="imp-guias">
      <h4><FileCheck2 size={18} aria-hidden="true" /> Guía(s) leída(s)</h4>
      {plan.guias.map(g => (
        <div key={g.seg || g.clave} className="imp-guia">
          <div>
            <strong>{g.numero || 'Sin número'}</strong> · {fechaCorta(g.fecha)}{g.hora ? ` ${g.hora}` : ''}
            {' · '}{g.origen_establecimiento || g.origen_nombre || 'origen sin leer'} → {g.destino_establecimiento || g.destino_nombre || 'destino sin leer'}
          </div>
          <div>
            {g.animales} bovino(s){g.total_declarado != null ? ` (la guía dice ${g.total_declarado})` : ''} · {g.ligados ?? 0} ligado(s) a un animal
            {' · '}<span className={`badge ${ACCION[g.accion][1]}`}>{ACCION[g.accion][0]}</span>
          </div>
          {g.guias_transporte?.length > 0 && (
            <div className="rp-tenue"><Truck size={14} aria-hidden="true" /> Guía de transporte de la app: {g.guias_transporte.map(t => t.numero).join(', ')}</div>
          )}
          {g.cambios?.map(c => <div key={c.campo} className="rp-tenue">{c.etiqueta}: {String(c.antes ?? '—')} → {String(c.despues ?? '—')}</div>)}
          {[...(g.errores || []), ...(g.avisos || [])].map((a, i) => <div key={i} style={{ color: 'var(--alerta)' }}><CircleAlert size={14} aria-hidden="true" /> {a}</div>)}
        </div>
      ))}
    </div>
  );
}

export default function GuiasMovilizacion() {
  const { id } = useParams();
  return id ? <DetalleGuia id={id} /> : <ListaGuias />;
}

function ListaGuias() {
  const { canEdit } = useAuth();
  const [guias, setGuias] = useState(null);
  const [error, setError] = useState(null);
  const cargar = useCallback(() => {
    setError(null);
    api.getGuiasMovilizacion().then(setGuias).catch(e => setError(e.message));
  }, []);
  useEffect(cargar, [cargar]);

  return (
    <div>
      <div className="page-header">
        <h2>Guías de movilización (MAG)</h2>
        <Link to="/transporte" className="btn btn-secondary"><ArrowLeft size={16} aria-hidden="true" /> Transporte</Link>
      </div>
      {!canEdit && <div className="banner info" role="status">Su usuario es de solo lectura: puede ver las guías pero no importarlas.</div>}

      <ImportadorDocumentos
        formato="guia-movilizacion" idTexto="gm-texto" canEdit={canEdit}
        accept=".pdf,.docx,.txt,application/pdf"
        ayuda={<>Suba el PDF de la guía FTZ-02 del SENASA (puede subir varias), el Word o una foto de cada página. La app lee el número, la fecha, origen → destino y el DIIO de cada bovino, y lo liga al animal que tiene esa I.E. en Ganadero SG. Un PDF escaneado (sin texto) va por «Cargar por foto». Nada se guarda hasta que revise la vista previa y presione «Aplicar».</>}
        placeholder={'SERVICIO NACIONAL DE SALUD ANIMAL\nNo.: EH0204095\nFecha: 15/10/2026\nDIIO\n1\t188001057994\tH\tCruza Brahman'}
        columnas={COLUMNAS}
        encabezados={(plan) => <EncabezadosGuias plan={plan} />}
        textoAplicar={(plan) => {
          const g = plan.guias.filter(x => x.accion !== 'error');
          return `Se guardarán ${g.length} guía(s) con ${plan.filas.filter(f => f.entidad === 'guia_movilizacion_animal' && f.accion !== 'error').length} bovino(s); ${plan.resumen.sin_animal || 0} quedan sin animal para ligarlos a mano.`;
        }}
        resultado={(r) => (
          <>
            {r.resumen.guias_nuevas} guía(s) nueva(s), {r.resumen.guias_actualizadas} actualizada(s); {r.resumen.animales_ligados} bovino(s) ligado(s), {r.resumen.sin_animal} sin animal.
            {r.guias?.map(g => <div key={g.id}><Link to={`/guias-movilizacion/${g.id}`}>Ver la guía {g.numero}</Link></div>)}
          </>
        )}
        onAplicado={cargar}
      />

      <div className="card">
        <h3 className="rp-subtitulo">Guías cargadas</h3>
        {error && <EstadoError mensaje={error} onReintentar={cargar} />}
        {!error && !guias && <Cargando />}
        {guias && guias.length === 0 && (
          <EstadoVacio icono={FileCheck2} titulo="Todavía no hay guías del MAG" texto="Suba el PDF o la foto de la guía de movilización arriba." />
        )}
        {guias && guias.length > 0 && (
          <div className="table-container">
            <table>
              <thead>
                <tr><th>Guía</th><th>Fecha</th><th>Origen</th><th>Destino</th><th className="num">Bovinos</th><th className="num">Sin animal</th><th>Guía de transporte</th></tr>
              </thead>
              <tbody>
                {guias.map(g => (
                  <tr key={g.id}>
                    <td><Link to={`/guias-movilizacion/${g.id}`}><strong>{g.numero}</strong></Link></td>
                    <td>{fechaCorta(g.fecha)}</td>
                    <td>{g.origen_establecimiento || '—'}</td>
                    <td>{g.destino_establecimiento || '—'}</td>
                    <td className="num">{g.animales}</td>
                    <td className="num">{g.sin_animal ? <span className="badge badge-yellow">{g.sin_animal}</span> : 0}</td>
                    <td>{g.guia_transporte_id ? <Link to={`/guias-transporte/${g.guia_transporte_id}`}>{g.guia_transporte_numero}</Link> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function DetalleGuia({ id }) {
  const { canEdit } = useAuth();
  const [guia, setGuia] = useState(null);
  const [error, setError] = useState(null);
  const cargar = useCallback(() => {
    setError(null);
    api.getGuiaMovilizacion(id).then(setGuia).catch(e => setError(e.message));
  }, [id]);
  useEffect(cargar, [cargar]);

  if (error) return <EstadoError mensaje={error} onReintentar={cargar} />;
  if (!guia) return <Cargando />;
  const sinAnimal = guia.animales.filter(a => !a.animal_id).length;

  return (
    <div>
      <div className="page-header">
        <h2>Guía de movilización {guia.numero}</h2>
        <Link to="/guias-movilizacion" className="btn btn-secondary"><ArrowLeft size={16} aria-hidden="true" /> Guías del MAG</Link>
      </div>
      <div className="card">
        <dl className="rp-encabezado">
          <div><dt>Fecha</dt><dd>{fechaCorta(guia.fecha)}{guia.hora ? ` ${guia.hora}` : ''}</dd></div>
          <div><dt>Autorización</dt><dd>{guia.autorizacion || '—'}</dd></div>
          <div><dt>Origen</dt><dd>{guia.origen_establecimiento || guia.origen_nombre || '—'}</dd></div>
          <div><dt>CUE origen</dt><dd>{guia.origen_cue || '—'}</dd></div>
          <div><dt>Destino</dt><dd>{guia.destino_establecimiento || guia.destino_nombre || '—'}</dd></div>
          <div><dt>CUE destino</dt><dd>{guia.destino_cue || '—'}</dd></div>
          <div><dt>Transportista</dt><dd>{guia.transportista || '—'}</dd></div>
          <div><dt>Placa</dt><dd>{guia.placa || '—'}</dd></div>
          <div><dt>Bovinos</dt><dd>{guia.animales.length}{guia.total_declarado != null && guia.total_declarado !== guia.animales.length ? ` (la guía dice ${guia.total_declarado})` : ''}</dd></div>
          <div><dt>Guía de transporte</dt><dd>{guia.guia_transporte_id ? <Link to={`/guias-transporte/${guia.guia_transporte_id}`}>{guia.guia_transporte_numero}</Link> : '—'}</dd></div>
        </dl>
        {sinAnimal > 0 && (
          <div className="banner info" role="status">
            <CircleAlert size={18} aria-hidden="true" />
            <div>{sinAnimal} DIIO no calza(n) con la I.E. de ningún animal. Escriba el arete para ligarlo a mano (por ejemplo, si el animal todavía no tiene la I.E. cargada).</div>
          </div>
        )}
        <div className="table-container">
          <table>
            <thead><tr><th className="num">#</th><th>DIIO</th><th>Sexo</th><th>Raza</th><th>Animal</th><th>I.E. del animal</th>{canEdit && <th>Ligar a mano</th>}</tr></thead>
            <tbody>
              {guia.animales.map(a => (
                <tr key={a.id}>
                  <td className="num">{a.orden}</td>
                  <td><code>{a.diio}</code></td>
                  <td>{SEXO[a.sexo] || '—'}</td>
                  <td>{a.raza || '—'}</td>
                  <td>
                    {a.animal_id ? <Link to={`/animales/${a.animal_id}`}><strong>{a.arete}</strong></Link> : <span className="badge badge-yellow">Sin animal</span>}
                    {a.vinculo === 'manual' && <span className="rp-tenue"> · a mano{a.vinculado_por_nombre ? ` (${a.vinculado_por_nombre})` : ''}</span>}
                  </td>
                  <td><code style={{ fontSize: '0.8em' }}>{a.identificacion_electronica || '—'}</code></td>
                  {canEdit && (
                    <td><LigarAnimal id={a.id} aretActual={a.arete} onLigar={async (arete) => setGuia(await api.ligarDiioGuia(guia.id, a.id, arete))} /></td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
