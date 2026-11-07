import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ClipboardCheck, ArrowLeft, CircleAlert } from 'lucide-react';
import { api } from '../services/api';
import { Cargando, EstadoError, EstadoVacio } from '../components/ui/Estados';
import { useAuth } from '../components/AuthContext';
import ImportadorDocumentos from '../components/importador/ImportadorDocumentos';
import LigarAnimal from '../components/importador/LigarAnimal';

/*
  Documentos de custodia de CIISA (bodega 107 EQTB TEMPISQUE):
    ASE · «Ajuste de salida en custodia»: producto que sale de la custodia (p. ej. para ZAMU).
    TRE · «Traslado de inventario en custodia»: de la 107 a otra bodega de la planta (paquetería).
  Normalmente llegan por foto; también PDF, Word, Excel o texto. De las Observaciones se saca
  «LOTE nn» (Lote CC) y «RES nnnn» (n.º de canal) para ligar el animal; si no se puede sin dudas,
  queda sin animal y se liga a mano en el detalle.
*/
const fechaCorta = (iso) => {
  if (!iso) return '—';
  const [f, h] = String(iso).split(' ');
  return `${f.split('-').reverse().join('/')}${h ? ` ${h.slice(0, 5)}` : ''}`;
};
const kg = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const cant = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }));
const TIPO = { ajuste_salida: ['ASE', 'Ajuste de salida'], traslado: ['TRE', 'Traslado'] };
const ACCION = { nuevo: ['Se crea', 'badge-green'], actualizar: ['Se actualiza', 'badge-blue'], sin_cambios: ['Sin cambios', 'badge-gray'], error: ['Con error', 'badge-red'] };
const bodega = (c, n) => (c ? `${c}${n ? ` ${n}` : ''}` : '—');

const COLUMNAS = [
  { titulo: 'Documento', valor: f => f.clave?.split(' · ')[0] || '—' },
  { titulo: 'Artículo', valor: f => <strong>{f.codigo || '—'}</strong> },
  { titulo: 'Descripción', valor: f => f.descripcion || '—' },
  { titulo: 'Equivale a', valor: f => f.codigo_equivalente || '—' },
  { titulo: 'Cajas', num: true, valor: f => cant(f.cajas) },
  { titulo: 'Kg', num: true, valor: f => kg(f.kg) },
];

function EncabezadosDocumentos({ plan }) {
  if (!plan.documentos?.length) return null;
  return (
    <div className="imp-guias">
      <h4><ClipboardCheck size={18} aria-hidden="true" /> Documento(s) leído(s)</h4>
      {plan.documentos.map(d => (
        <div key={d.seg || d.clave} className="imp-guia">
          <div>
            <strong>{d.clave}</strong> · {d.tipo_texto} · {fechaCorta(d.fecha_hora)}
            {' · '}{bodega(d.bodega_origen_codigo, d.bodega_origen_nombre)}{d.bodega_destino_codigo ? ` → ${bodega(d.bodega_destino_codigo, d.bodega_destino_nombre)}` : ''}
          </div>
          {d.observaciones && <div>Observaciones: «{d.observaciones}»{d.lote_cc != null ? ` · Lote CC ${d.lote_cc}` : ''}{d.res ? ` · RES ${d.res}` : ''}</div>}
          <div>
            {d.lineas} artículo(s) · {cant(d.total_cajas)} caja(s) · {kg(d.total_kg)} kg
            {d.total_kg_declarado != null && Math.abs(d.total_kg_declarado - d.total_kg) > 0.05 ? ` (el documento dice ${kg(d.total_kg_declarado)} kg)` : ''}
            {' · '}Animal: {d.arete ? <strong>{d.arete}</strong> : <span className="badge badge-yellow">Sin animal</span>}
            {' · '}<span className={`badge ${ACCION[d.accion][1]}`}>{ACCION[d.accion][0]}</span>
          </div>
          {d.cambios?.map(c => <div key={c.campo} className="rp-tenue">{c.etiqueta}: {String(c.antes ?? '—')} → {String(c.despues ?? '—')}</div>)}
          {[...(d.errores || []), ...(d.avisos || [])].map((a, i) => <div key={i} className="aviso-linea"><CircleAlert size={14} aria-hidden="true" /> <span>{a}</span></div>)}
        </div>
      ))}
    </div>
  );
}

export default function DocumentosCustodia() {
  const { id } = useParams();
  return id ? <DetalleDocumento id={id} /> : <ListaDocumentos />;
}

function ListaDocumentos() {
  const { canEdit } = useAuth();
  const [docs, setDocs] = useState(null);
  const [tipo, setTipo] = useState('');
  const [error, setError] = useState(null);
  const cargar = useCallback(() => {
    setError(null);
    api.getDocumentosCustodia(tipo ? { tipo } : {}).then(setDocs).catch(e => setError(e.message));
  }, [tipo]);
  useEffect(cargar, [cargar]);

  return (
    <div>
      <div className="page-header">
        <h2>Documentos de custodia CIISA</h2>
        <Link to="/custodia" className="btn btn-secondary"><ArrowLeft size={16} aria-hidden="true" /> Custodia</Link>
      </div>
      {!canEdit && <div className="banner info" role="status">Su usuario es de solo lectura: puede ver los documentos pero no importarlos.</div>}

      <ImportadorDocumentos
        formato="custodia-ciisa" idTexto="dc-texto" canEdit={canEdit}
        accept=".pdf,.docx,.xlsx,.txt,application/pdf"
        ayuda={<>«Ajuste de salida en custodia» (ASE) y «Traslado de inventario en custodia» (TRE) de la bodega 107. Tómeles foto (una por página; varias fotos de documentos distintos se separan solas) o suba el PDF, Word o Excel. De las Observaciones se toma el LOTE (Lote CC) y la RES (n.º de canal) para ligar el animal. Nada se guarda hasta que revise la vista previa y presione «Aplicar».</>}
        placeholder={'CENTRO INTERNACIONAL DE INVERSIONES S.A\nTRASLADO DE INVENTARIO EN CUSTODIA\nNo.: 1824\nBodega Origen: 107 EQTB TEMPISQUE\nFecha: 24-04-2026 16:04:48\nObservaciones: CORTES FINOS LOTE 35 / RES 5094\n22140\tCESINA DE RES LIMPIA CP\tCAJ\t1.00\tKGS\t3.66'}
        columnas={COLUMNAS}
        encabezados={(plan) => <EncabezadosDocumentos plan={plan} />}
        textoAplicar={(plan) => {
          const d = plan.documentos.filter(x => x.accion !== 'error');
          return `Se guardarán ${d.length} documento(s) con ${plan.filas.filter(f => f.entidad === 'custodia_linea' && f.accion !== 'error').length} artículo(s).`;
        }}
        resultado={(r) => (
          <>
            {r.resumen.documentos_nuevos} documento(s) nuevo(s), {r.resumen.documentos_actualizados} actualizado(s); {r.resumen.ligados} ligado(s) a un animal.
            {r.documentos?.map(d => <div key={d.id}><Link to={`/documentos-custodia/${d.id}`}>Ver {d.clave}</Link></div>)}
          </>
        )}
        onAplicado={cargar}
      />

      <div className="card">
        <div className="card-header">
          <h3>Documentos cargados</h3>
          <div>
            <label htmlFor="dc-tipo" className="sr-only">Tipo de documento</label>
            <select id="dc-tipo" value={tipo} onChange={e => setTipo(e.target.value)}>
              <option value="">Todos</option>
              <option value="ajuste_salida">Ajustes de salida (ASE)</option>
              <option value="traslado">Traslados (TRE)</option>
            </select>
          </div>
        </div>
        {error && <EstadoError mensaje={error} onReintentar={cargar} />}
        {!error && !docs && <Cargando />}
        {docs && docs.length === 0 && (
          <EstadoVacio icono={ClipboardCheck} titulo="Todavía no hay documentos" texto="Cargue la foto del ajuste o del traslado arriba." />
        )}
        {docs && docs.length > 0 && (
          <div className="table-container">
            <table>
              <thead>
                <tr><th>Documento</th><th>Fecha</th><th>Origen → destino</th><th>Observaciones</th><th>Animal</th><th className="num">Artículos</th><th className="num">Kg</th></tr>
              </thead>
              <tbody>
                {docs.map(d => (
                  <tr key={d.id}>
                    <td><Link to={`/documentos-custodia/${d.id}`}><strong>{TIPO[d.tipo][0]} {d.numero}</strong></Link></td>
                    <td>{fechaCorta(d.fecha)}</td>
                    <td>{bodega(d.bodega_origen_codigo, d.bodega_origen_nombre)}{d.bodega_destino_codigo ? ` → ${bodega(d.bodega_destino_codigo, d.bodega_destino_nombre)}` : ''}</td>
                    <td>{d.observaciones || '—'}</td>
                    <td>{d.animal_id ? <Link to={`/animales/${d.animal_id}`}>{d.arete}</Link> : (d.lote_cc != null || d.res ? <span className="badge badge-yellow">Sin animal</span> : '—')}</td>
                    <td className="num">{d.lineas}</td>
                    <td className="num">{kg(d.total_kg)}</td>
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

function DetalleDocumento({ id }) {
  const { canEdit } = useAuth();
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState(null);
  const cargar = useCallback(() => {
    setError(null);
    api.getDocumentoCustodia(id).then(setDoc).catch(e => setError(e.message));
  }, [id]);
  useEffect(cargar, [cargar]);

  if (error) return <EstadoError mensaje={error} onReintentar={cargar} />;
  if (!doc) return <Cargando />;
  const [corto, nombre] = TIPO[doc.tipo];
  const difiere = doc.total_kg_declarado != null && Math.abs(Number(doc.total_kg_declarado) - Number(doc.total_kg)) > 0.05;

  return (
    <div>
      <div className="page-header">
        <h2>{nombre} {corto} {doc.numero}</h2>
        <Link to="/documentos-custodia" className="btn btn-secondary"><ArrowLeft size={16} aria-hidden="true" /> Documentos de custodia</Link>
      </div>
      <div className="card">
        <dl className="rp-encabezado">
          <div><dt>Fecha</dt><dd>{fechaCorta(doc.fecha)}</dd></div>
          <div><dt>Bodega origen</dt><dd>{bodega(doc.bodega_origen_codigo, doc.bodega_origen_nombre)}</dd></div>
          <div><dt>Bodega destino</dt><dd>{bodega(doc.bodega_destino_codigo, doc.bodega_destino_nombre)}</dd></div>
          <div><dt>Estado</dt><dd>{doc.estado || '—'}</dd></div>
          <div><dt>Lote CC</dt><dd>{doc.lote_cc ?? '—'}</dd></div>
          <div><dt>RES</dt><dd>{doc.res || '—'}</dd></div>
          <div><dt>Total</dt><dd>{cant(doc.total_cajas)} caja(s) · {kg(doc.total_kg)} kg</dd></div>
          <div>
            <dt>Animal</dt>
            <dd>
              {doc.animal_id ? <Link to={`/animales/${doc.animal_id}`}>{doc.arete}</Link> : 'Sin animal'}
              {doc.vinculo === 'manual' && <span className="rp-tenue"> · a mano</span>}
            </dd>
          </div>
        </dl>
        {doc.observaciones && <p className="rp-nota">Observaciones: «{doc.observaciones}»</p>}
        {difiere && (
          <div className="banner info" role="status">
            <CircleAlert size={18} aria-hidden="true" />
            <div>El documento dice {kg(doc.total_kg_declarado)} kg{doc.total_cajas_declarado != null ? ` y ${cant(doc.total_cajas_declarado)} unidades` : ''}; las líneas cargadas suman {kg(doc.total_kg)} kg. Puede faltar una página: vuelva a cargarlo con todas las fotos.</div>
          </div>
        )}
        {canEdit && (
          <div className="form-group ligar-documento">
            <span className="rp-nota">Ligar el documento a mano a un animal (por su arete):</span>
            <LigarAnimal id={`doc-${doc.id}`} aretActual={doc.arete} onLigar={async (arete) => setDoc(await api.ligarDocumentoCustodia(doc.id, arete))} />
          </div>
        )}
        <div className="table-container">
          <table className="tabla-con-total">
            <thead><tr><th className="num">#</th><th>Artículo</th><th>Descripción</th><th>Equivale a</th><th>Und.</th><th className="num">Cajas</th><th className="num">Kg</th></tr></thead>
            <tbody>
              {doc.lineas.map(l => (
                <tr key={l.id}>
                  <td className="num">{l.orden}</td>
                  <td><strong>{l.codigo}</strong></td>
                  <td>{l.descripcion || l.nombre_catalogo || '—'}</td>
                  <td>{l.codigo_equivalente || '—'}</td>
                  <td>{l.unidad || '—'}</td>
                  <td className="num">{cant(l.cajas)}</td>
                  <td className="num">{kg(l.kg)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td colSpan={5}><strong>Total</strong></td><td className="num" data-label-fija data-label="Cajas"><strong>{cant(doc.total_cajas)}</strong></td><td className="num" data-label-fija data-label="Kg"><strong>{kg(doc.total_kg)}</strong></td></tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
