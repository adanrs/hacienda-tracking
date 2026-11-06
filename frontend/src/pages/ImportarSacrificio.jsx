import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ClipboardPaste, Upload, CheckCircle2, ArrowLeft, Copy, Download, Mail, RefreshCw } from 'lucide-react';
import { api } from '../services/api';
import Boton from '../components/ui/Boton';
import { confirmar } from '../components/ui/confirmar';
import { aviso } from '../components/ui/avisos';
import { useAuth } from '../components/AuthContext';
import VistaPrevia from '../components/importador/VistaPrevia';
import ResumenPlan from '../components/importador/ResumenPlan';
import useImportacion from '../components/importador/useImportacion';

/*
  Sacrificio desde el correo de CIISA («Sacrificio Wagyu dd-mm-aa»). Dos entradas:
    (a) PEGAR la tabla (preferida): se lee el HTML del portapapeles (Outlook/Gmail/Excel lo ponen)
        y si no viene, el texto plano;
    (b) SUBIR el correo .msg (Outlook) o .eml.
  La guía de transporte manda: los aretes se validan contra ella y los mal escritos se proponen
  como corrección editable. Al final queda el reporte de discrepancias para mandarle a la planta.
*/
const fechaCorta = (iso) => (iso ? iso.split('-').reverse().join('/') : '—');
const n = (x, d = 1) => (x == null ? '—' : Number(x).toLocaleString('en-US', { maximumFractionDigits: d }));

export default function ImportarSacrificio() {
  const { canEdit } = useAuth();
  const [params] = useSearchParams();
  const refArchivo = useRef(null);
  const [pegado, setPegado] = useState({ html: '', texto: '' });
  const [fecha, setFecha] = useState('');
  const [guiaId, setGuiaId] = useState(params.get('guia') || '');
  const [guias, setGuias] = useState([]);
  const [correcciones, setCorrecciones] = useState({});
  const [reporteFinal, setReporteFinal] = useState(null); // el reporte sigue visible después de registrar
  const imp = useImportacion('sacrificio-ciisa');
  const { plan } = imp;

  useEffect(() => { api.getGuiasTransporte().then(gs => setGuias(gs.filter(g => g.estado !== 'anulada'))).catch(() => setGuias([])); }, []);
  // La fecha del asunto llena el campo si el usuario no escribió otra.
  useEffect(() => { if (plan?.fecha_sacrificio && !fecha) setFecha(plan.fecha_sacrificio); }, [plan]); // eslint-disable-line react-hooks/exhaustive-deps

  const opciones = (extra = {}) => ({ fecha_sacrificio: fecha || undefined, guia_id: guiaId || undefined, correcciones, ...extra });

  const alPegar = (e) => {
    const html = e.clipboardData.getData('text/html');
    const texto = e.clipboardData.getData('text/plain');
    if (html || texto) {
      e.preventDefault();
      setPegado({ html, texto });
      setCorrecciones({}); setBorradores({});
      imp.planificar({ pegado: { html, texto } }, opciones({ correcciones: {} }));
    }
  };

  const leerPegado = () => {
    if (!pegado.texto.trim() && !pegado.html) { aviso.error('Pegue la tabla del correo primero'); return; }
    imp.planificar({ pegado }, opciones());
  };

  const elegir = async (e) => {
    const a = e.target.files?.[0];
    e.target.value = '';
    if (!a) return;
    if (a.size > 5 * 1024 * 1024) { aviso.error('El archivo pesa más de 5 MB'); return; }
    setCorrecciones({}); setBorradores({});
    await imp.planificar({ archivo: a }, opciones({ correcciones: {} }));
  };

  // Un arete mal escrito por la planta nunca se liga solo: el usuario confirma (o escribe) el correcto
  // fila por fila y se vuelve a revisar todo con esa corrección.
  const [borradores, setBorradores] = useState({});
  const confirmarArete = (f) => {
    const valor = (borradores[f.fila] ?? f.correccion?.propuesto ?? '').trim().toUpperCase();
    if (!valor) { aviso.error('Escriba el arete correcto'); return; }
    const nuevas = { ...correcciones, [f.fila]: valor };
    setCorrecciones(nuevas);
    imp.replanificar(opciones({ correcciones: nuevas }));
  };
  const recalcular = () => imp.replanificar(opciones());

  const aplicar = async () => {
    const ok = await confirmar({
      titulo: '¿Registrar el sacrificio?',
      mensaje: `Se registran ${plan.resumen.nuevos + plan.resumen.actualizados} canal(es) del ${fechaCorta(plan.fecha_sacrificio)}.${plan.resumen.errores ? ` ${plan.resumen.errores} fila(s) con error NO se registran.` : ''}`,
      textoConfirmar: 'Registrar',
    });
    if (!ok) return;
    const reporte = plan.reporte_planta;
    const r = await imp.aplicar();
    if (r) { aviso.ok('Sacrificio registrado'); setReporteFinal(reporte); }
  };
  const reporte = plan?.reporte_planta || reporteFinal;

  const copiar = async () => {
    try { await navigator.clipboard.writeText(reporte); aviso.ok('Reporte copiado: péguelo en el correo a la planta'); } catch { aviso.error('No se pudo copiar: selecciónelo y cópielo a mano'); }
  };
  const descargar = () => {
    const url = URL.createObjectURL(new Blob([reporte], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `discrepancias-sacrificio-${plan?.fecha_sacrificio || fecha || 'ciisa'}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const COLUMNAS = [
    { titulo: 'Canal', valor: f => <strong>{f.numero_canal || '—'}</strong> },
    {
      titulo: 'Arete', valor: (f) => {
        if (f.correccion?.confirmado) {
          return <span><s title="Como lo escribió la planta">{f.arete_informado}</s>{' → '}<strong>{f.arete}</strong> <span className="badge badge-blue">confirmado</span></span>;
        }
        if (f.correccion || (f.accion === 'error' && /no está/.test(f.errores.join()))) {
          return (
            <span className="imp-correccion">
              <s title="Como lo escribió la planta">{f.arete_informado}</s>{' → '}
              <input
                aria-label={`Arete correcto para la canal ${f.numero_canal}`}
                className="imp-input-arete"
                value={borradores[f.fila] ?? f.correccion?.propuesto ?? ''}
                placeholder="arete"
                disabled={!canEdit}
                onChange={e => setBorradores(b => ({ ...b, [f.fila]: e.target.value.toUpperCase() }))}
              />
              <button type="button" className="btn btn-secondary btn-sm" disabled={!canEdit || imp.cargando} onClick={() => confirmarArete(f)}>Confirmar</button>
            </span>
          );
        }
        return <strong>{f.arete || f.arete_informado || '—'}</strong>;
      },
    },
    { titulo: 'Guía', valor: f => f.guia?.numero || '—' },
    { titulo: 'Pie (kg)', num: true, valor: f => n(f.datos?.peso_vivo) },
    { titulo: 'Salida (kg)', num: true, valor: f => n(f.peso_salida_kg) },
    { titulo: 'Merma %', num: true, valor: f => (f.merma_pct == null ? '—' : <span style={f.merma_pct > 8 ? { color: 'var(--alerta)', fontWeight: 700 } : {}}>{n(f.merma_pct, 2)}</span>) },
    { titulo: 'Canal (kg)', num: true, valor: f => n(f.datos?.peso_canal_caliente) },
    { titulo: 'Rend. %', num: true, valor: f => n(f.datos?.rendimiento_canal, 2) },
    { titulo: 'Músc.', num: true, valor: f => f.datos?.musculo ?? '—' },
    { titulo: 'Dientes', num: true, valor: f => f.datos?.denticion ?? '—' },
    { titulo: 'Grasa', num: true, valor: f => f.datos?.grasa ?? '—' },
    { titulo: 'Golpe', valor: f => f.datos?.golpe || '—' },
  ];

  return (
    <div>
      <div className="page-header">
        <h2>Sacrificio desde el correo de CIISA</h2>
        <Link to="/sacrificio" className="btn btn-secondary"><ArrowLeft size={16} aria-hidden="true" /> Volver a Sacrificio</Link>
      </div>

      <div className="grid-2">
        <div className="card">
          <h3 className="rp-subtitulo"><ClipboardPaste size={20} aria-hidden="true" /> Pegar la tabla del correo</h3>
          <p className="rp-nota">En Outlook o Gmail seleccione la tabla completa (con los encabezados), cópiela y péguela aquí. La vista previa aparece sola.</p>
          <label htmlFor="pegado-sacrificio" className="sr-only">Tabla pegada</label>
          <textarea
            id="pegado-sacrificio"
            rows={7}
            className="imp-pegado"
            placeholder="Pegue aquí (Ctrl+V) la tabla «Cantidad · Número de canal · Sexo · Peso pie · Peso canal · Rendimiento · Arete · Músculo · Dientes · Grasa · Golpe»"
            value={pegado.texto}
            onPaste={alPegar}
            onChange={e => setPegado({ html: '', texto: e.target.value })}
            disabled={!canEdit}
          />
          <Boton icono={RefreshCw} onClick={leerPegado} cargando={imp.cargando} disabled={!canEdit}>Leer lo pegado</Boton>
        </div>
        <div className="card">
          <h3 className="rp-subtitulo"><Mail size={20} aria-hidden="true" /> O subir el correo</h3>
          <p className="rp-nota">Guarde el correo desde Outlook (.msg) o descárguelo de Gmail como .eml («Descargar mensaje»).</p>
          <Boton variante="primario" icono={Upload} cargando={imp.cargando} disabled={!canEdit} onClick={() => refArchivo.current?.click()}>Elegir correo…</Boton>
          <input ref={refArchivo} type="file" accept=".msg,.eml,.html,.htm,.txt,.csv,.xlsx" onChange={elegir} hidden />
          <div className="form-row" style={{ marginTop: 'var(--esp-4)' }}>
            <div className="form-group">
              <label htmlFor="fecha-sacrificio">Fecha de sacrificio</label>
              <input id="fecha-sacrificio" type="date" value={fecha} onChange={e => setFecha(e.target.value)} />
              <small className="rp-tenue">Se toma del asunto del correo; puede cambiarla.</small>
            </div>
            <div className="form-group">
              <label htmlFor="guia-sacrificio">Guía de transporte</label>
              <select id="guia-sacrificio" value={guiaId} onChange={e => setGuiaId(e.target.value)}>
                <option value="">Las de los últimos 7 días</option>
                {guias.map(g => <option key={g.id} value={g.id}>{g.numero} · {fechaCorta(g.fecha_salida)} · {g.total_animales} animales</option>)}
              </select>
            </div>
          </div>
          {plan && <Boton icono={RefreshCw} onClick={recalcular} cargando={imp.cargando}>Volver a revisar con esta fecha y guía</Boton>}
        </div>
      </div>

      {imp.resultado && (
        <div className="banner ok" role="status">
          <CheckCircle2 size={18} aria-hidden="true" />
          <div>
            <strong>Sacrificio registrado:</strong> {imp.resultado.resultado.resumen.sacrificios_nuevos} canal(es) nueva(s), {imp.resultado.resultado.resumen.sacrificios_actualizados} actualizada(s).
            {' '}<Link to="/sacrificio">Ver sacrificios</Link> · <Link to="/solicitud-deshuese">Armar la solicitud de deshuese</Link>
          </div>
        </div>
      )}

      {plan && (
        <div className="card">
          <div className="card-header">
            <h3>Vista previa · sacrificio del {fechaCorta(plan.fecha_sacrificio)}</h3>
            <div className="rp-acciones">
              <Boton variante="primario" icono={CheckCircle2} cargando={imp.aplicando}
                disabled={!canEdit || plan.errores_generales?.length > 0 || plan.resumen.nuevos + plan.resumen.actualizados === 0}
                onClick={aplicar}>
                Registrar sacrificio
              </Boton>
            </div>
          </div>
          {plan.errores_generales?.length > 0 && <div className="banner error" role="alert">{plan.errores_generales.join(' ')}</div>}
          {plan.filas.some(f => f.correccion && !f.correccion.confirmado) && <div className="banner info" role="status">Hay aretes que la planta pudo escribir mal: revise la propuesta en la columna Arete y presione «Confirmar» en cada uno. Sin confirmar, esa canal no se registra.</div>}
          <p className="rp-nota">
            Guías consideradas: {plan.guias_consideradas?.length ? plan.guias_consideradas.map(g => `${g.numero} (${fechaCorta(g.fecha_salida)})`).join(', ') : 'ninguna'}
          </p>
          <ResumenPlan resumen={plan.resumen} extra={[{ etiqueta: 'Enviados sin sacrificio', valor: plan.pendientes.length, clase: plan.pendientes.length ? 'imp-alerta' : '' }]} />
          <VistaPrevia key={plan.huella} filas={plan.filas} columnas={COLUMNAS} filtroInicial="todas" />
          {plan.pendientes.length > 0 && (
            <div className="banner info" role="status" style={{ marginTop: 'var(--esp-4)' }}>
              <div><strong>Animales de la guía que no vienen en este reporte:</strong> {plan.pendientes.map(p => `${p.arete} (${p.guia})`).join(', ')}</div>
            </div>
          )}
        </div>
      )}

      {reporte && (
        <div className="card">
          <div className="card-header">
            <h3>Reporte de discrepancias para la planta</h3>
            <div className="rp-acciones">
              <Boton icono={Copy} onClick={copiar}>Copiar texto</Boton>
              <Boton icono={Download} onClick={descargar}>Descargar .txt</Boton>
            </div>
          </div>
          <label htmlFor="reporte-planta" className="sr-only">Texto del reporte para la planta</label>
          <textarea id="reporte-planta" className="imp-pegado" rows={Math.min(14, reporte.split('\n').length + 1)} readOnly value={reporte} />
        </div>
      )}
    </div>
  );
}
