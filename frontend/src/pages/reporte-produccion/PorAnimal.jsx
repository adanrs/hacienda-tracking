import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, FileText, Upload } from 'lucide-react';
import { api } from '../../services/api';
import { aviso } from '../../components/ui/avisos';
import { FilaEstado } from '../../components/ui/Estados';

/*
  Vista principal del Reporte de producción: un renglón por reporte de CIISA (= un animal, por el
  acuerdo con El Arreo), con su arete, rendimiento sobre el peso canal, PDF original y el detalle de
  artículos desplegable. Arriba, el % con trazabilidad de cada tanda (día de producción).
*/
const fecha = (iso) => (iso ? iso.split('-').reverse().join('/') : '—');
const kg = (x) => (x == null ? '—' : Number(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

export default function PorAnimal({ irA }) {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [abiertos, setAbiertos] = useState({});

  const cargar = () => { setError(null); api.getReportesPorAnimal().then(setDatos).catch(e => setError(e.message)); };
  useEffect(cargar, []);

  const alternar = async (r) => {
    if (abiertos[r.id]) { setAbiertos(a => ({ ...a, [r.id]: null })); return; }
    try { const lineas = await api.getLineasReporte(r.id); setAbiertos(a => ({ ...a, [r.id]: lineas })); } catch (e) { aviso.error(e.message); }
  };

  const reportes = datos?.reportes || [];
  return (
    <div>
      {datos?.tandas?.length > 0 && (
        <dl className="imp-resumen" aria-label="Trazabilidad por tanda">
          {datos.tandas.slice(0, 6).map(t => (
            <div key={t.fecha} className={`imp-dato ${t.pct < 100 ? 'imp-error' : 'imp-ok'}`}>
              <dt>Tanda {fecha(t.fecha)}</dt>
              <dd className="traz-pct">{t.pct} % con trazabilidad</dd>
              <dd style={{ fontSize: 'var(--texto-sm)', fontWeight: 400 }}>{t.con_arete} de {t.total} lotes con arete</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="card">
        <div className="page-header" style={{ marginBottom: 'var(--esp-3)' }}>
          <h3 style={{ margin: 0 }}>Reportes por animal</h3>
          <button type="button" className="btn btn-primary" onClick={() => irA('importar')}><Upload size={16} aria-hidden="true" /> Importar PDF de CIISA</button>
        </div>
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th><span className="sr-only">Detalle</span></th>
                <th>Producción</th><th className="num">Lote</th><th>Arete</th><th>Trazabilidad</th><th>Canal</th>
                <th className="num">Kilos</th><th className="num">Cajas</th><th className="num">Peso canal</th><th className="num">Rend. %</th>
                <th>Vence</th><th>PDF</th>
              </tr>
            </thead>
            <tbody>
              <FilaEstado columnas={12} cargando={!datos && !error} error={error} vacio={datos && !reportes.length} onReintentar={cargar}
                tituloVacio="Todavía no hay reportes de producción" textoVacio="Importe los PDF que manda CIISA con la lista lote → arete del correo." />
              {reportes.map(r => (
                <Fragment key={r.id}>
                  <tr className={r.trazabilidad === 'sin_trazabilidad' ? 'rp-fila-falta' : ''}>
                    <td>
                      <button type="button" className="btn-icon" aria-expanded={Boolean(abiertos[r.id])} aria-label={`Ver artículos del lote ${r.num_lote || r.lote_cc}`} onClick={() => alternar(r)}>
                        {abiertos[r.id] ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
                      </button>
                    </td>
                    <td>{fecha(r.fecha_produccion)}</td>
                    <td className="num">{r.num_lote || r.lote_cc}</td>
                    <td>{r.animal_id ? <Link to={`/animales/${r.animal_id}`}><strong>{r.numero_trazabilidad}</strong></Link> : '—'}</td>
                    <td>{r.trazabilidad === 'con_arete' ? <span className="badge badge-green">Con arete</span> : <span className="badge badge-yellow">Lote sin animal</span>}
                      {r.lineas_pendientes > 0 && <span className="badge badge-orange" style={{ marginLeft: 4 }}>{r.lineas_pendientes} sin codificar</span>}</td>
                    <td>{r.numero_canal || '—'}</td>
                    <td className="num">{kg(r.kilos)}</td>
                    <td className="num">{r.cajas}</td>
                    <td className="num">{kg(r.peso_canal)}</td>
                    <td className="num">{r.rendimiento == null ? '—' : <span style={r.rendimiento > 90 ? { color: 'var(--alerta)', fontWeight: 700 } : {}} title={r.rendimiento > 90 ? 'Más del 90 % del peso canal: ¿lote con varios animales?' : undefined}>{kg(r.rendimiento)}</span>}</td>
                    <td>{fecha(r.vencimiento)}</td>
                    <td>{r.pdf_url ? <a href={r.pdf_url} target="_blank" rel="noreferrer" aria-label={`PDF del lote ${r.num_lote || r.lote_cc}`}><FileText size={16} aria-hidden="true" /></a> : '—'}</td>
                  </tr>
                  {abiertos[r.id] && (
                    <tr>
                      <td />
                      <td colSpan={11}>
                        <table className="tabla-compacta">
                          <thead><tr><th>Código</th><th>Descripción CIISA</th><th>Catálogo</th><th className="num">Kilos</th><th className="num">Cajas</th></tr></thead>
                          <tbody>
                            {abiertos[r.id].map(l => (
                              <tr key={l.linea}>
                                <td>{l.articulo_codigo === '99' ? <span className="badge badge-orange" title={`La planta trajo ${l.codigo_informado}`}>99 · {l.codigo_informado}</span> : l.articulo_codigo}</td>
                                <td>{l.descripcion}</td><td>{l.nombre_catalogo || '—'}{l.tipo === 'trimming' ? ' (molida)' : ''}</td>
                                <td className="num">{kg(l.peso_kg)}</td><td className="num">{l.cajas}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
