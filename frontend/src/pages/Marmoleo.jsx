import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Save, ClipboardPaste, Upload, CheckCircle2, Copy, RefreshCw, Gauge } from 'lucide-react';
import { api } from '../services/api';
import Boton from '../components/ui/Boton';
import { aviso } from '../components/ui/avisos';
import { confirmar } from '../components/ui/confirmar';
import { Cargando, EstadoVacio, EstadoError } from '../components/ui/Estados';
import { useAuth } from '../components/AuthContext';
import VistaPrevia from '../components/importador/VistaPrevia';
import ResumenPlan from '../components/importador/ResumenPlan';
import useImportacion from '../components/importador/useImportacion';
import LecturaFoto from '../components/importador/LecturaFoto';

/*
  Marmoleo por canal: etapa entre Sacrificio y Solicitud de deshuese.
  Lo único que se registra es el marmoleo AUS-MEAT (DMs AUSMEAT de la cámara, entero 0–9).
    - «Por canal»: elegir la fecha de sacrificio y escribir el marmoleo de cada canal en la tabla.
    - «Pegar de la cámara»: seleccionar la tabla en la página de la cámara, copiar y pegar aquí.
      Se amarra por número de sacrificio + arete («Body no.»); si solo coincide uno de los dos,
      la fila queda en error hasta que usted confirme a mano el sacrificio correcto.
*/
const fechaCorta = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');

export default function Marmoleo() {
  const [params] = useSearchParams();
  const [tab, setTab] = useState('canal');
  return (
    <div>
      <div className="page-header"><h2>Marmoleo</h2></div>
      <div className="tabs" role="tablist" aria-label="Marmoleo">
        {[['canal', 'Por canal', Gauge], ['camara', 'Pegar de la cámara', ClipboardPaste]].map(([id, texto, Icono]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={`tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
            <Icono size={16} style={{ marginRight: 6 }} aria-hidden="true" />{texto}
          </button>
        ))}
      </div>
      {tab === 'canal' ? <PorCanal fechaInicial={params.get('fecha')} /> : <DesdeCamara />}
    </div>
  );
}

function PorCanal({ fechaInicial }) {
  const { canEdit } = useAuth();
  const [fechas, setFechas] = useState([]);
  const [fecha, setFecha] = useState(fechaInicial || '');
  const [canales, setCanales] = useState(null);
  const [valores, setValores] = useState({});
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    api.getMarmoleoFechas().then((fs) => {
      setFechas(fs);
      if (!fechaInicial && fs.length) setFecha((fs.find(f => f.sin_medir > 0) || fs[0]).fecha);
    }).catch(() => setFechas([]));
  }, [fechaInicial]);

  const cargar = useCallback(() => {
    if (!fecha) return;
    setError(null);
    setCanales(null);
    api.getMarmoleo(fecha).then((cs) => {
      setCanales(cs);
      setValores(Object.fromEntries(cs.map(c => [c.sacrificio_id, c.marmoleo ?? ''])));
    }).catch(e => setError(e.message));
  }, [fecha]);
  useEffect(cargar, [cargar]);

  const cambiados = canales ? canales.filter(c => String(valores[c.sacrificio_id] ?? '') !== String(c.marmoleo ?? '')) : [];
  const invalidos = cambiados.filter(c => valores[c.sacrificio_id] !== '' && !/^[0-9]$/.test(String(valores[c.sacrificio_id])));

  const guardar = async () => {
    if (invalidos.length) { aviso.error('El marmoleo AUS-MEAT es un número entero de 0 a 9'); return; }
    setGuardando(true);
    try {
      await api.guardarMarmoleo({ mediciones: cambiados.map(c => ({ sacrificio_id: c.sacrificio_id, marmoleo: valores[c.sacrificio_id] === '' ? null : Number(valores[c.sacrificio_id]) })) });
      aviso.ok(`Marmoleo guardado (${cambiados.length} canal(es))`);
      cargar();
    } catch (e) { aviso.error(e.message); } finally { setGuardando(false); }
  };

  return (
    <div className="card">
      <div className="form-row">
        <div className="form-group">
          <label htmlFor="mm-fecha">Fecha de sacrificio</label>
          <input id="mm-fecha" type="date" value={fecha} onChange={e => setFecha(e.target.value)} />
        </div>
        <div className="form-group">
          <label htmlFor="mm-fechas">Días con sacrificios</label>
          <select id="mm-fechas" value={fecha} onChange={e => setFecha(e.target.value)}>
            <option value="">Elegir…</option>
            {fechas.map(f => <option key={f.fecha} value={f.fecha}>{fechaCorta(f.fecha)} · {f.canales} canal(es){f.sin_medir ? ` · ${f.sin_medir} sin medir` : ''}</option>)}
          </select>
        </div>
      </div>
      {!fecha && <EstadoVacio icono={Gauge} titulo="Elija la fecha de sacrificio" texto="Solo se puede medir marmoleo de canales ya sacrificadas." />}
      {fecha && error && <EstadoError mensaje={error} onReintentar={cargar} />}
      {fecha && !error && !canales && <Cargando />}
      {canales && canales.length === 0 && (
        <EstadoVacio icono={Gauge} titulo={`No hay sacrificios el ${fechaCorta(fecha)}`} texto={<>Registre primero el sacrificio (<Link to="/sacrificio/importar-ciisa">importar el correo de CIISA</Link>).</>} />
      )}
      {canales && canales.length > 0 && (
        <>
          <div className="table-container">
            <table>
              <thead><tr><th>Canal</th><th>Arete</th><th className="num">Peso canal (kg)</th><th>Marmoleo AUS-MEAT (0–9)</th><th>Medido</th></tr></thead>
              <tbody>
                {canales.map(c => (
                  <tr key={c.sacrificio_id}>
                    <td><strong>{c.numero_canal || '—'}</strong></td>
                    <td><Link to={`/animales/${c.animal_id}`}>{c.arete}</Link></td>
                    <td className="num">{c.peso_canal_caliente ?? '—'}</td>
                    <td>
                      <input
                        aria-label={`Marmoleo AUS-MEAT de la canal ${c.numero_canal || c.arete}`}
                        className="imp-input-arete" inputMode="numeric" maxLength={1}
                        value={valores[c.sacrificio_id] ?? ''} disabled={!canEdit}
                        onChange={e => setValores(v => ({ ...v, [c.sacrificio_id]: e.target.value.replace(/\D/g, '') }))}
                      />
                    </td>
                    <td className="rp-tenue">{c.fecha_marmoleo ? `${fechaCorta(c.fecha_marmoleo)}${c.desde_camara ? ' · cámara' : ''}${c.medido_por ? ` · ${c.medido_por}` : ''}` : 'Sin medir'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="rp-acciones" style={{ marginTop: 'var(--esp-3)' }}>
            <Boton variante="primario" icono={Save} cargando={guardando} disabled={!canEdit || !cambiados.length} onClick={guardar}>
              Guardar {cambiados.length ? `(${cambiados.length})` : ''}
            </Boton>
            <Link to="/solicitud-deshuese" className="btn btn-secondary">Ir a la solicitud de deshuese</Link>
          </div>
        </>
      )}
    </div>
  );
}

function DesdeCamara() {
  const { canEdit } = useAuth();
  const refArchivo = useRef(null);
  const [pegado, setPegado] = useState({ html: '', texto: '' });
  const [confirmaciones, setConfirmaciones] = useState({});
  // El texto salió de una foto: la vista previa marca lo que hay que revisar (backend importador/foto.js).
  const [foto, setFoto] = useState(null);
  const imp = useImportacion('marmoleo-camara');
  const { plan } = imp;
  const [reporteFinal, setReporteFinal] = useState(null);

  const alPegar = (e) => {
    const html = e.clipboardData.getData('text/html');
    const texto = e.clipboardData.getData('text/plain');
    if (!html && !texto) return;
    e.preventDefault();
    setPegado({ html, texto });
    setConfirmaciones({}); setFoto(null);
    imp.planificar({ pegado: { html, texto } }, { confirmaciones: {} });
  };
  const elegir = (e) => {
    const a = e.target.files?.[0];
    e.target.value = '';
    if (!a) return;
    setConfirmaciones({}); setFoto(null);
    imp.planificar({ archivo: a }, { confirmaciones: {} });
  };
  const ligar = (fila, sacrificioId) => {
    const nuevas = { ...confirmaciones, [fila]: sacrificioId };
    setConfirmaciones(nuevas);
    imp.replanificar({ confirmaciones: nuevas });
  };
  const aplicar = async () => {
    const ok = await confirmar({ titulo: '¿Guardar el marmoleo?', mensaje: `Se guarda el marmoleo AUS-MEAT de ${plan.resumen.nuevos + plan.resumen.actualizados} canal(es).${plan.resumen.errores ? ` ${plan.resumen.errores} fila(s) con error NO se guardan.` : ''}`, textoConfirmar: 'Guardar' });
    if (!ok) return;
    const rep = plan.reporte_planta;
    if (await imp.aplicar()) { aviso.ok('Marmoleo guardado'); setReporteFinal(rep); }
  };
  const reporte = plan?.reporte_planta || reporteFinal;

  const COLUMNAS = [
    { titulo: 'Tomado', valor: f => (f.tomado_en ? `${fechaCorta(f.tomado_en)} ${f.tomado_en.slice(11, 16)}` : '—') },
    { titulo: 'Body no.', valor: f => <code>{f.body || '—'}</code> },
    {
      titulo: 'Sacrificio', valor: (f) => {
        if (f.sacrificio_id) return <span>Canal <strong>{f.canal}</strong> · {f.arete}{f.confirmado && <> <span className="badge badge-blue">confirmado</span></>}</span>;
        if (f.candidatos?.length) {
          return (
            <span className="imp-correccion">
              {f.candidatos.map(c => (
                <button key={c.sacrificio_id} type="button" className="btn btn-secondary btn-sm" disabled={!canEdit || imp.cargando} onClick={() => ligar(f.fila, c.sacrificio_id)}>
                  Ligar a canal {c.canal} · {c.arete} ({fechaCorta(c.fecha)})
                </button>
              ))}
            </span>
          );
        }
        return '—';
      },
    },
    { titulo: 'AUS-MEAT', num: true, valor: f => <strong>{f.ausmeat ?? '—'}</strong> },
  ];

  return (
    <div>
      <div className="grid-2">
        <div className="card">
          <h3 className="rp-subtitulo"><ClipboardPaste size={20} aria-hidden="true" /> Pegar la tabla de la cámara</h3>
          <p className="rp-nota">En la página de la cámara seleccione la tabla con el mouse (desde «Taken at» hasta la última fila), cópiela y péguela aquí. Se usan Body no. y DMs (AUSMEAT); las demás columnas se guardan como dato extra.</p>
          <label htmlFor="mm-pegado" className="sr-only">Tabla pegada</label>
          <textarea id="mm-pegado" className="imp-pegado" rows={6} value={pegado.texto} disabled={!canEdit}
            placeholder="Pegue aquí (Ctrl+V) la tabla de la cámara"
            onPaste={alPegar} onChange={e => { setPegado({ html: '', texto: e.target.value }); if (!e.target.value.trim()) setFoto(null); }} />
          <div className="rp-acciones">
            <Boton icono={RefreshCw} cargando={imp.cargando} disabled={!canEdit || !pegado.texto.trim()} onClick={() => imp.planificar({ pegado }, { confirmaciones, foto: foto || undefined })}>Leer lo pegado</Boton>
            <Boton icono={Upload} disabled={!canEdit} onClick={() => refArchivo.current?.click()}>O subir CSV/Excel…</Boton>
            <input ref={refArchivo} type="file" accept=".csv,.txt,.xlsx,.html,.htm,.docx" hidden onChange={elegir} />
            {/* Foto de la pantalla de la cámara: se transcriben solo Body no. y DMs (AUSMEAT) y el texto
                queda en el cuadro de arriba para revisarlo antes de leerlo (nunca se aplica directo). */}
            <LecturaFoto formato="marmoleo-camara" deshabilitado={!canEdit}
              onTexto={(t, dudas) => { setPegado({ html: '', texto: t }); setFoto({ dudosas: dudas }); if (dudas.length) aviso.info(`Revise con cuidado (baja confianza): ${dudas.join(', ')}`); }} />
          </div>
        </div>
        <div className="card">
          <h3 className="rp-subtitulo">Cómo se amarra cada medición</h3>
          <p className="rp-nota">
            «Body no.» trae el <strong>número de sacrificio</strong> y el <strong>arete</strong> (p. ej. «5111 17DKF»). Se liga solo si los dos coinciden con un sacrificio registrado.
            Si coincide solo uno, la fila queda en rojo con el sacrificio sugerido: revíselo y presione «Ligar» para confirmarlo a mano. Esas diferencias quedan en el reporte para la planta.
          </p>
        </div>
      </div>

      {imp.resultado && <div className="banner ok" role="status"><CheckCircle2 size={18} aria-hidden="true" /> Marmoleo guardado en {imp.resultado.resultado.resumen.mediciones} canal(es). <Link to="/solicitud-deshuese">Armar la solicitud de deshuese</Link></div>}

      {plan && (
        <div className="card">
          <div className="card-header">
            <h3>Vista previa del marmoleo</h3>
            <Boton variante="primario" icono={CheckCircle2} cargando={imp.aplicando} disabled={!canEdit || plan.resumen.nuevos + plan.resumen.actualizados === 0} onClick={aplicar}>Guardar marmoleo</Boton>
          </div>
          <ResumenPlan resumen={plan.resumen} />
          <VistaPrevia key={plan.huella} filas={plan.filas} columnas={COLUMNAS} />
        </div>
      )}

      {reporte && (
        <div className="card">
          <div className="card-header">
            <h3>Reporte de discrepancias para la planta</h3>
            <Boton icono={Copy} onClick={() => navigator.clipboard.writeText(reporte).then(() => aviso.ok('Copiado'), () => aviso.error('No se pudo copiar'))}>Copiar texto</Boton>
          </div>
          <textarea className="imp-pegado" readOnly rows={Math.min(12, reporte.split('\n').length + 1)} value={reporte} aria-label="Reporte para la planta" />
        </div>
      )}
    </div>
  );
}
