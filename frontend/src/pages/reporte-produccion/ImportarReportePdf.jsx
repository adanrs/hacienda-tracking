import { useRef, useState } from 'react';
import { Upload, CheckCircle2, Copy, ListChecks } from 'lucide-react';
import Boton from '../../components/ui/Boton';
import { confirmar } from '../../components/ui/confirmar';
import { aviso } from '../../components/ui/avisos';
import VistaPrevia from '../../components/importador/VistaPrevia';
import ResumenPlan from '../../components/importador/ResumenPlan';
import useImportacion from '../../components/importador/useImportacion';
import LecturaFoto from '../../components/importador/LecturaFoto';
import AltaRapidaCorte from '../../components/AltaRapidaCorte';

/*
  Importar el Reporte de producción de CIISA: VARIOS PDF a la vez (cada PDF = un animal = un lote),
  o el texto pegado, más la lista «Lote CC → arete» del correo (por LOTE CC, el lote de deshuese de las
  etiquetas; NO por «Num. Lote», que es el correlativo del PDF). La lista es el único sello canal ↔ arete:
  se valida contra los animales sacrificados con la regla estricta (propuesta editable y confirmación
  obligatoria; o «importar sin animal» si la planta no mandó el arete). Vista previa por reporte con
  kilos, cajas, rendimiento sobre el peso canal y avisos; el detalle de artículos se despliega.
*/
const fecha = (iso) => (iso ? iso.split('-').reverse().join('/') : '—');
const kg = (x) => (x == null ? '—' : Number(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const ETIQUETA_TRAZ = {
  con_arete: ['Con arete', 'badge-green'],
  confirmada_a_mano: ['Confirmado a mano', 'badge-blue'],
  sin_trazabilidad: ['Sin trazabilidad', 'badge-yellow'],
};

export default function ImportarReportePdf({ canEdit, onAplicado }) {
  const refArchivos = useRef(null);
  const [archivos, setArchivos] = useState([]);
  const [texto, setTexto] = useState('');
  const [dudosas, setDudosas] = useState([]);
  // El texto (o parte) salió de una foto: la vista previa marca sus filas a revisar (backend importador/foto.js).
  const [foto, setFoto] = useState(false);
  const [mapa, setMapa] = useState('');
  const [correcciones, setCorrecciones] = useState({});
  const [sinAnimal, setSinAnimal] = useState({});
  const [pendientes, setPendientes] = useState({});
  const [reemplazos, setReemplazos] = useState({});
  const [borradores, setBorradores] = useState({});
  const [alta, setAlta] = useState(null);
  const [reporteFinal, setReporteFinal] = useState(null);
  const imp = useImportacion('reporte-produccion-ciisa');
  const { plan } = imp;

  const opciones = (extra = {}) => ({ mapa, correcciones, sin_animal: sinAnimal, pendientes, reemplazar_arete: reemplazos, foto: foto && texto.trim() ? { dudosas } : undefined, ...extra });
  const entrada = (a = archivos, t = texto) => ({ archivos: a, pegado: t.trim() ? { texto: t } : undefined });

  const revisar = (extra = {}, a = archivos, t = texto) => {
    if (!a.length && !t.trim()) { aviso.error('Adjunte los PDF o pegue el texto del reporte'); return; }
    imp.planificar(entrada(a, t), opciones(extra));
  };

  const elegir = (e) => {
    const nuevos = [...(e.target.files || [])];
    e.target.value = '';
    const grandes = nuevos.filter(f => f.size > 5 * 1024 * 1024);
    if (grandes.length) { aviso.error(`${grandes.map(f => f.name).join(', ')} pesa(n) más de 5 MB`); return; }
    const todos = [...archivos, ...nuevos.filter(n => !archivos.some(a => a.name === n.name))].slice(0, 40);
    setArchivos(todos);
  };
  const quitar = (nombre) => setArchivos(a => a.filter(x => x.name !== nombre));

  const confirmarArete = (f) => {
    const valor = (borradores[f.fila] ?? f.correccion?.propuesto ?? '').trim().toUpperCase();
    if (!valor) { aviso.error('Escriba el arete correcto'); return; }
    // Las correcciones y «sin animal» van por Lote CC (la llave de la lista del correo), no por Num. Lote.
    const nuevas = { ...correcciones, [f.lote_clave]: valor };
    const sa = { ...sinAnimal }; delete sa[f.lote_clave];
    setCorrecciones(nuevas); setSinAnimal(sa);
    imp.replanificar({ correcciones: nuevas, sin_animal: sa });
  };
  const importarSinAnimal = (f) => {
    const sa = { ...sinAnimal, [f.lote_clave]: true };
    setSinAnimal(sa);
    imp.replanificar({ sin_animal: sa });
  };
  // El lote ya tenía otro arete cargado (a mano o por otra importación): reemplazarlo se confirma.
  const confirmarReemplazo = async (f) => {
    const ok = await confirmar({ titulo: `¿Reemplazar el arete del lote CC ${f.lote_clave}?`, mensaje: `Estaba cargado ${f.cambio_arete.antes}; quedará ${f.cambio_arete.despues}. El cambio va al reporte de discrepancias.`, textoConfirmar: 'Reemplazar' });
    if (!ok) return;
    const n = { ...reemplazos, [f.clave_lote]: true }; // llave fecha|lote CC (ver el procesador)
    setReemplazos(n);
    imp.replanificar({ reemplazar_arete: n });
  };
  const marcarPendiente = (codigo) => {
    const p = { ...pendientes, [codigo]: true };
    setPendientes(p);
    imp.replanificar({ pendientes: p });
  };

  const aplicar = async () => {
    const r = plan.resumen;
    const ok = await confirmar({
      titulo: '¿Registrar los reportes de producción?',
      mensaje: `Se registran ${r.nuevos} reporte(s); ${r.sin_cambios} ya estaban cargados.${r.errores ? ` ${r.errores} con error NO se registran.` : ''} Trazabilidad de la tanda: ${plan.trazabilidad?.pct ?? '—'} %.`,
      textoConfirmar: 'Registrar',
    });
    if (!ok) return;
    const reporte = plan.reporte_planta;
    const res = await imp.aplicar();
    if (res) {
      aviso.ok(`Reportes registrados: ${res.resultado.resumen.reportes_nuevos}${res.resultado.resumen.solicitudes_con_reporte ? ` · ${res.resultado.resumen.solicitudes_con_reporte} solicitud(es) pasan a «con reporte»` : ''}`);
      setReporteFinal(reporte); setArchivos([]); setTexto(''); setDudosas([]); setFoto(false);
      onAplicado?.();
    }
  };
  const reporte = plan?.reporte_planta || reporteFinal;
  const copiar = async () => {
    try { await navigator.clipboard.writeText(reporte); aviso.ok('Reporte copiado: péguelo en el correo a la planta'); } catch { aviso.error('No se pudo copiar: selecciónelo y cópielo a mano'); }
  };

  const COLUMNAS = [
    { titulo: 'Archivo', valor: f => <span title={f.documento}>{(f.documento || 'Texto pegado').slice(0, 28)}{f.parte ? ` (${f.parte})` : ''}</span> },
    { titulo: 'Producción', valor: f => fecha(f.fecha_produccion) },
    { titulo: 'Lote CC', num: true, valor: f => f.lote_clave ? <span title={f.num_lote ? `Num. Lote ${f.num_lote} (correlativo del PDF)` : undefined}>{f.lote_clave}</span> : '—' },
    {
      titulo: 'Arete', valor: (f) => {
        if (f.requiere_vision) return <span className="badge badge-orange">PDF escaneado: tómele una foto a cada página con «Cargar por foto»</span>;
        const pideArete = f.correccion || (f.accion === 'error' && /arete/i.test(f.errores.join(' ')));
        if (pideArete && canEdit) {
          return (
            <span className="imp-correccion">
              {f.arete_lista && <><s title="Como viene en la lista del correo">{f.arete_lista}</s>{' → '}</>}
              <input aria-label={`Arete correcto del lote CC ${f.lote_clave}`} className="imp-input-arete" placeholder="arete"
                value={borradores[f.fila] ?? f.correccion?.propuesto ?? ''}
                onChange={e => setBorradores(b => ({ ...b, [f.fila]: e.target.value.toUpperCase() }))} />
              <button type="button" className="btn btn-secondary btn-sm" disabled={imp.cargando} onClick={() => confirmarArete(f)}>Confirmar</button>
              <button type="button" className="btn btn-secondary btn-sm" disabled={imp.cargando} onClick={() => importarSinAnimal(f)}>Sin animal</button>
            </span>
          );
        }
        if (f.cambio_arete && !reemplazos[f.clave_lote] && canEdit) {
          return (
            <span className="imp-correccion">
              <s title="Arete que ya estaba cargado">{f.cambio_arete.antes}</s>{' → '}<strong>{f.cambio_arete.despues}</strong>
              <button type="button" className="btn btn-secondary btn-sm" disabled={imp.cargando} onClick={() => confirmarReemplazo(f)}>Reemplazar</button>
            </span>
          );
        }
        return <strong>{f.arete || '—'}</strong>;
      },
    },
    { titulo: 'Trazabilidad', valor: f => { const [t, c] = ETIQUETA_TRAZ[f.trazabilidad] || ETIQUETA_TRAZ.sin_trazabilidad; return <span className={`badge ${c}`}>{t}</span>; } },
    { titulo: 'Kilos', num: true, valor: f => kg(f.kilos) },
    { titulo: 'Cajas', num: true, valor: f => f.cajas ?? '—' },
    { titulo: 'Rend. %', num: true, valor: f => (f.rendimiento == null ? '—' : <span style={f.rendimiento > 90 ? { color: 'var(--alerta)', fontWeight: 700 } : {}}>{kg(f.rendimiento)}</span>) },
    { titulo: 'Vence', valor: f => fecha(f.vencimiento) },
  ];

  const detalle = (f) => (
    <div>
      {f.codigos_desconocidos?.length > 0 && canEdit && (
        <div className="aviso-inline aviso-alerta" style={{ marginBottom: 8 }}>
          <p><strong>Códigos que no están en el catálogo</strong></p>
          {f.codigos_desconocidos.map(c => (
            <div key={c.codigo} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
              <span><strong>{c.codigo}</strong> {c.descripcion}</span>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setAlta(c)}>Agregar al catálogo</button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => marcarPendiente(c.codigo)}>Dejar pendiente (99)</button>
            </div>
          ))}
        </div>
      )}
      {f.lineas?.length > 0 && (
        <table className="tabla-compacta">
          <thead><tr><th>Código</th><th>Descripción CIISA</th><th>Catálogo</th><th className="num">Kilos</th><th className="num">Cajas</th></tr></thead>
          <tbody>
            {f.lineas.map(l => (
              <tr key={l.linea} className={l.estado_codigo === 'desconocido' ? 'rp-fila-dif' : l.estado_codigo !== 'ok' ? 'rp-fila-falta' : ''}>
                <td>{l.estado_codigo === 'pendiente' ? `99 · ${l.codigo_informado}` : l.articulo_codigo}</td>
                <td>{l.descripcion}</td>
                <td>{l.nombre_catalogo || (l.estado_codigo === 'desconocido' ? 'No está en el catálogo' : '—')}{l.estado_codigo === 'inactivo' ? ' (inactivo)' : ''}</td>
                <td className="num">{kg(l.peso_kg)}</td><td className="num">{l.cajas}</td>
              </tr>
            ))}
          </tbody>
          {f.pie && <tfoot><tr><td colSpan={3}>Pie del PDF: {kg(f.pie.libras)} lb</td><td className="num">{kg(f.pie.kilos)}</td><td className="num">{f.pie.cajas}</td></tr></tfoot>}
        </table>
      )}
    </div>
  );

  return (
    <div>
      <div className="grid-2">
        <div className="card">
          <h3>1. Los PDF del reporte</h3>
          <p className="rp-tenue">Cada PDF «REPORTE DIARIO DE PRODUCCION» es un animal. Puede adjuntar todos los de la tanda a la vez.</p>
          <input ref={refArchivos} type="file" accept=".pdf,.txt,application/pdf,text/plain" multiple hidden onChange={elegir} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Boton icono={Upload} disabled={!canEdit} onClick={() => refArchivos.current?.click()}>Adjuntar PDF</Boton>
            <LecturaFoto formato="reporte-produccion-ciisa" deshabilitado={!canEdit}
              onTexto={(t, d) => { setTexto(prev => (prev.trim() ? `${prev}\n${t}` : t)); setDudosas(prev => [...new Set([...prev, ...d])]); setFoto(true); }} />
          </div>
          {archivos.length > 0 && (
            <ul className="lista-archivos">
              {archivos.map(a => (
                <li key={a.name}>{a.name} <button type="button" className="btn-icon" aria-label={`Quitar ${a.name}`} onClick={() => quitar(a.name)}>&times;</button></li>
              ))}
            </ul>
          )}
          <div className="form-group" style={{ marginTop: 12 }}>
            <label htmlFor="rp-texto">O pegue el texto del reporte (o revise lo que leyó la foto)</label>
            <textarea id="rp-texto" rows={6} value={texto} onChange={e => { setTexto(e.target.value); if (!e.target.value.trim()) { setFoto(false); setDudosas([]); } }} placeholder={'REPORTE DIARIO DE PRODUCCION\nFecha de Produccion: 19/10/26\nNum. Lote 2 …'} />
            {dudosas.length > 0 && (
              <div className="transcripcion-dudas" aria-label="Partes que la lectura no pudo leer bien">
                <span className="rp-tenue">Revise con cuidado (baja confianza):</span>
                {dudosas.map((d, i) => <span key={i} className="texto-dudoso">{d}</span>)}
              </div>
            )}
          </div>
        </div>
        <div className="card">
          <h3>2. La lista Lote CC → arete del correo</h3>
          <p className="rp-tenue">Copie del correo la tabla Lote CC → arete («35 279SKF, 36 255CKF…»): es el «Lote CC» del pie del PDF, no el «Num. Lote». Se valida contra los animales sacrificados: un arete mal escrito se propone y usted lo confirma.</p>
          <div className="form-group">
            <label htmlFor="rp-mapa">Lista Lote CC → arete</label>
            <textarea id="rp-mapa" rows={8} value={mapa} onChange={e => setMapa(e.target.value)} placeholder={'35  279SKF\n36  255CKF\n37  599SKF'} />
          </div>
          <Boton variante="primario" icono={ListChecks} cargando={imp.cargando} disabled={!canEdit} onClick={() => { setCorrecciones({}); setSinAnimal({}); setBorradores({}); revisar({ correcciones: {}, sin_animal: {} }); }}>
            Ver vista previa
          </Boton>
        </div>
      </div>

      {plan && (
        <div className="card">
          <h3>Vista previa de la tanda</h3>
          <ResumenPlan resumen={plan.resumen} extra={[
            { etiqueta: 'Con trazabilidad', valor: plan.trazabilidad?.pct == null ? '—' : `${plan.trazabilidad.pct} %`, clase: plan.trazabilidad?.pct === 100 ? 'imp-ok' : 'imp-error' },
          ]} />
          {plan.errores_generales?.length > 0 && <div className="aviso-inline aviso-error"><p>{plan.errores_generales.join(' ')}</p></div>}
          {plan.faltantes?.length > 0 && <p className="rp-tenue">La lista trae lotes sin PDF en esta tanda: {plan.faltantes.map(x => `${x.lote} (${x.arete})`).join(', ')}.</p>}
          <VistaPrevia filas={plan.filas} columnas={COLUMNAS} renderExtra={detalle} />
          <div className="modal-actions">
            <Boton variante="primario" icono={CheckCircle2} cargando={imp.aplicando} disabled={!canEdit || !(plan.resumen.nuevos)} onClick={aplicar}>
              Registrar {plan.resumen.nuevos} reporte(s)
            </Boton>
          </div>
        </div>
      )}

      {reporte && (
        <div className="card">
          <h3>Reporte de discrepancias para la planta</h3>
          <textarea readOnly rows={8} value={reporte} aria-label="Reporte de discrepancias" style={{ width: '100%' }} />
          <Boton icono={Copy} onClick={copiar}>Copiar</Boton>
        </div>
      )}

      {alta && (
        <AltaRapidaCorte codigo={alta.codigo} descripcion={alta.descripcion || ''} onCerrar={() => setAlta(null)}
          onCreado={() => { setAlta(null); imp.replanificar({}); }} />
      )}
    </div>
  );
}
