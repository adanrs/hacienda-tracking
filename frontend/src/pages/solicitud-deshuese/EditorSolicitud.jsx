import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Save, Send, Download, RotateCcw, CircleCheck, Trash2, CircleAlert, Info, Warehouse } from 'lucide-react';
import { api } from '../../services/api';
import { aviso } from '../../components/ui/avisos';
import { confirmar } from '../../components/ui/confirmar';
import Boton from '../../components/ui/Boton';
import { Cargando, EstadoError, EstadoVacio } from '../../components/ui/Estados';
import { fmtKg, fechaCorta } from '../reporte-produccion/util';
import { ESTADO_SOLICITUD, SEXO, MEDIAS, normalizarNumeroCanal, nombreExcel } from './util';

/** Estado editable a partir del modelo que devuelve el backend. */
function estadoInicial(modelo) {
  return {
    numeros: Object.fromEntries(modelo.canales.map(c => [c.sacrificio_id, c.numero_canal || ''])),
    medias: Object.fromEntries(modelo.cortes.map(k => [k.codigo, { ...k.medias }])),
    obs: Object.fromEntries(modelo.cortes.map(k => [k.codigo, k.observacion || ''])),
    observaciones: modelo.solicitud?.observaciones || '',
  };
}

/*
  Editor de la solicitud de un día: encabezado por canal (arete, sexo, pesos, n.º de canal) y
  la matriz corte × canal con 0, 1 o 2 medias, más una observación por corte.
*/
export default function EditorSolicitud({ fecha, setFecha, canEdit, onSucio, onCambio }) {
  const [modelo, setModelo] = useState(null);
  const [edicion, setEdicion] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [errores, setErrores] = useState([]);
  const [ocupado, setOcupado] = useState(null); // 'guardar' | 'enviar' | ... evita dobles envíos
  const [sucio, setSucioLocal] = useState(false);
  const [enviadaA, setEnviadaA] = useState('CIISA');

  // onSucio llega como función nueva en cada render del padre: se guarda en una ref para que no
  // dispare de nuevo la carga (cargar depende de setSucio) y se perderían los cambios en pantalla.
  const refOnSucio = useRef(onSucio);
  refOnSucio.current = onSucio;
  const setSucio = useCallback((v) => { setSucioLocal(v); refOnSucio.current(v); }, []);
  useEffect(() => () => refOnSucio.current(false), []);

  const aplicarModelo = useCallback((m) => {
    setModelo(m);
    setEdicion(estadoInicial(m));
    setErrores([]);
    setSucio(false);
  }, [setSucio]);

  const cargar = useCallback(() => {
    setCargando(true);
    setError(null);
    api.getSolicitudDeshuesePorFecha(fecha)
      .then(aplicarModelo)
      .catch(e => setError(e.message))
      .finally(() => setCargando(false));
  }, [fecha, aplicarModelo]);
  useEffect(() => { cargar(); }, [cargar]);

  const sol = modelo?.solicitud || null;
  const editable = Boolean(canEdit && modelo?.editable);
  const estado = sol ? ESTADO_SOLICITUD[sol.estado] : null;

  const totales = useMemo(() => {
    if (!modelo || !edicion) return {};
    return Object.fromEntries(modelo.canales.map(c => [
      c.sacrificio_id,
      modelo.cortes.reduce((s, k) => s + Number(edicion.medias[k.codigo]?.[c.sacrificio_id] ?? 0), 0),
    ]));
  }, [modelo, edicion]);

  const cambiar = (fn) => { setEdicion(e => fn(e)); setSucio(true); };
  const setMedia = (codigo, sid, v) => cambiar(e => ({ ...e, medias: { ...e.medias, [codigo]: { ...e.medias[codigo], [sid]: v } } }));
  const setFila = (codigo, v) => cambiar(e => ({ ...e, medias: { ...e.medias, [codigo]: Object.fromEntries(Object.keys(e.medias[codigo]).map(k => [k, v])) } }));
  const setTodo = (v) => cambiar(e => ({ ...e, medias: Object.fromEntries(Object.entries(e.medias).map(([c, fila]) => [c, Object.fromEntries(Object.keys(fila).map(k => [k, v]))])) }));

  const cuerpo = () => ({
    fecha_sacrificio: fecha,
    observaciones: edicion.observaciones,
    canales: modelo.canales.map(c => ({ sacrificio_id: c.sacrificio_id, numero_canal: edicion.numeros[c.sacrificio_id] || null })),
    lineas: modelo.cortes.map(k => ({ corte_codigo: k.codigo, observacion: edicion.obs[k.codigo] || null, medias: edicion.medias[k.codigo] })),
  });

  const conError = (e) => {
    setErrores(e.datos?.detalles?.length ? e.datos.detalles : [e.message]);
    aviso.error(e.message);
  };

  /** Guarda (alta o edición). Devuelve el modelo guardado o null si falló. */
  const guardar = async ({ silencioso = false } = {}) => {
    setErrores([]);
    setOcupado('guardar');
    try {
      const m = sol ? await api.guardarSolicitudDeshuese(sol.id, cuerpo()) : await api.crearSolicitudDeshuese(cuerpo());
      aplicarModelo(m);
      onCambio();
      if (!silencioso) aviso.ok(sol ? 'Solicitud guardada' : `Solicitud N.º ${m.solicitud.numero} creada como borrador`);
      return m;
    } catch (e) {
      conError(e);
      return null;
    } finally { setOcupado(null); }
  };

  const transicion = async (accion, fn, mensajeOk) => {
    setErrores([]);
    setOcupado(accion);
    try {
      aplicarModelo(await fn());
      onCambio();
      aviso.ok(mensajeOk);
    } catch (e) { conError(e); } finally { setOcupado(null); }
  };

  const enviar = async () => {
    const ok = await confirmar({
      titulo: '¿Marcar la solicitud como enviada?',
      mensaje: 'Se guarda la versión actual y ya no se podrá editar, salvo que la reabra. Recuerde mandar el Excel a la planta: el envío por correo todavía no está disponible.',
      textoConfirmar: 'Marcar como enviada',
    });
    if (!ok) return;
    let actual = sol;
    if (sucio || !actual) {
      const m = await guardar({ silencioso: true });
      if (!m) return;
      actual = m.solicitud;
    }
    await transicion('enviar', () => api.enviarSolicitudDeshuese(actual.id, enviadaA.trim() || null), 'Solicitud marcada como enviada');
  };

  const descargar = async () => {
    let actual = sol;
    if (editable && (sucio || !actual)) {
      const m = await guardar({ silencioso: true });
      if (!m) return;
      actual = m.solicitud;
    }
    setOcupado('excel');
    try {
      await api.descargarSolicitudDeshuese(actual.id, nombreExcel(actual));
    } catch (e) { aviso.error(e.message); } finally { setOcupado(null); }
  };

  const reabrir = async () => {
    const ok = await confirmar({
      titulo: '¿Reabrir la solicitud para corregirla?',
      mensaje: 'Vuelve a borrador. Si la planta ya tiene la versión anterior, mándele la corregida.',
      textoConfirmar: 'Reabrir',
    });
    if (ok) await transicion('reabrir', () => api.reabrirSolicitudDeshuese(sol.id), 'La solicitud volvió a borrador');
  };

  const deshuesada = async () => {
    const ok = await confirmar({ titulo: '¿Marcar la solicitud como deshuesada?', mensaje: 'Indica que la planta ya deshuesó estas canales.', textoConfirmar: 'Marcar como deshuesada' });
    if (ok) await transicion('deshuesada', () => api.marcarSolicitudDeshuesada(sol.id), 'Solicitud marcada como deshuesada');
  };

  const eliminar = async () => {
    const ok = await confirmar({ titulo: `¿Eliminar el borrador N.º ${sol.numero}?`, mensaje: 'Los n.º de canal se quedan guardados en cada sacrificio.', textoConfirmar: 'Eliminar', peligro: true });
    if (!ok) return;
    setOcupado('eliminar');
    try {
      await api.deleteSolicitudDeshuese(sol.id);
      aviso.ok('Borrador eliminado');
      onCambio();
      setSucio(false);
      cargar();
    } catch (e) { conError(e); } finally { setOcupado(null); }
  };

  const filtroFecha = (
    <div className="filter-bar">
      <label htmlFor="sd-fecha">Fecha de sacrificio</label>
      <input id="sd-fecha" type="date" value={fecha} onChange={e => setFecha(e.target.value)} />
    </div>
  );

  if (cargando) return <>{filtroFecha}<div className="card"><Cargando texto="Cargando canales del día…" /></div></>;
  if (error) return <>{filtroFecha}<div className="card"><EstadoError mensaje={error} onReintentar={cargar} /></div></>;

  if (!modelo.canales.length) {
    return (
      <>
        {filtroFecha}
        <div className="card">
          <EstadoVacio
            icono={Warehouse}
            titulo={`No hay sacrificios registrados el ${fechaCorta(fecha)}`}
            texto="La solicitud se arma con las canales del día. Registre primero los sacrificios o elija otra fecha."
            accion={canEdit ? <Link className="btn btn-secondary" to="/sacrificio">Ir a Sacrificio</Link> : null}
          />
        </div>
      </>
    );
  }

  const canales = modelo.canales;
  const nuevasCanales = canales.filter(c => c.nuevo).length;
  const nuevosCortes = modelo.cortes.filter(k => k.nuevo).length;
  const pct = Math.round(modelo.pct_deshuese_est * 100);

  return (
    <div>
      {filtroFecha}

      <section className="card" aria-labelledby="sd-titulo">
        <div className="card-header">
          <h3 id="sd-titulo">
            {sol ? `Solicitud N.º ${sol.numero}` : 'Solicitud nueva'} · sacrificio del {fechaCorta(fecha)}
          </h3>
          {estado && <span className={`badge ${estado.badge}`}><estado.Icono size={12} aria-hidden="true" /> {estado.texto}</span>}
        </div>
        {!sol && (
          <div className="banner info"><Info size={18} aria-hidden="true" /> Todavía no hay solicitud para esta fecha. Revise la propuesta (todo en {modelo.medias_defecto} medias) y guárdela como borrador.</div>
        )}
        {sol && (
          <p className="rp-nota">
            {sol.creado_por ? `Creada por ${sol.creado_por}. ` : ''}
            {sol.actualizada ? `Última modificación: ${sol.actualizada}. ` : ''}
            {sol.enviada_en ? `Enviada el ${sol.enviada_en}${sol.enviada_a ? ` a ${sol.enviada_a}` : ''}.` : ''}
          </p>
        )}
        {sol && editable && (nuevasCanales > 0 || nuevosCortes > 0) && (
          <div className="banner info">
            <Info size={18} aria-hidden="true" />
            <span>
              {nuevasCanales > 0 && `${nuevasCanales} canal(es) del día no estaban en la solicitud. `}
              {nuevosCortes > 0 && `${nuevosCortes} corte(s) nuevos del catálogo. `}
              Se agregaron con {modelo.medias_defecto} medias, marcados con «nuevo»: revíselos y guarde.
            </span>
          </div>
        )}
        {modelo.canales_quitadas > 0 && (
          <div className="banner info"><Info size={18} aria-hidden="true" /> {modelo.canales_quitadas} canal(es) ya no son de esta fecha (se corrigió el sacrificio) y se quitaron. Guarde para confirmarlo.</div>
        )}
        {!editable && sol && canEdit && sol.estado === 'enviada' && (
          <div className="banner info"><Info size={18} aria-hidden="true" /> La solicitud ya se envió y no se puede editar. Para corregirla, reábrala.</div>
        )}
      </section>

      {/* ── Encabezado por canal ── */}
      <section className="card" aria-labelledby="sd-canales">
        <h3 className="rp-subtitulo" id="sd-canales">Canales del día</h3>
        <div className="sd-scroll">
          <table className="sd-tabla sd-encabezado">
            <thead>
              <tr>
                <th scope="col" className="sd-fija">Dato</th>
                {canales.map((c, i) => (
                  <th key={c.sacrificio_id} scope="col" className="num">
                    Canal {i + 1}{c.nuevo && <span className="badge badge-orange sd-nuevo">nuevo</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr><th scope="row" className="sd-fija">Arete</th>{canales.map(c => <td key={c.sacrificio_id} className="num"><Link to={`/animales/${c.animal_id}`}>{c.arete}</Link></td>)}</tr>
              <tr><th scope="row" className="sd-fija">Sexo</th>{canales.map(c => <td key={c.sacrificio_id} className="num">{SEXO[c.sexo] || c.sexo || '—'}</td>)}</tr>
              <tr><th scope="row" className="sd-fija">Peso en pie finca (kg)</th>{canales.map(c => <td key={c.sacrificio_id} className="num">{fmtKg(c.peso_pie_finca)}</td>)}</tr>
              <tr><th scope="row" className="sd-fija">Peso en pie planta (kg)</th>{canales.map(c => <td key={c.sacrificio_id} className="num">{fmtKg(c.peso_vivo)}</td>)}</tr>
              <tr>
                <th scope="row" className="sd-fija">Peso canal (kg)</th>
                {canales.map(c => (
                  <td key={c.sacrificio_id} className="num">
                    {fmtKg(c.peso_canal)}
                    {c.peso_canal_origen && <span className="sd-tenue-bloque">{c.peso_canal_origen === 'frio' ? 'frío' : 'caliente'}</span>}
                  </td>
                ))}
              </tr>
              <tr>
                <th scope="row" className="sd-fija">N.º de canal</th>
                {canales.map((c, i) => (
                  <td key={c.sacrificio_id} className="num">
                    {editable ? (
                      <input
                        className="sd-input-canal"
                        aria-label={`N.º de canal de ${c.arete || `la canal ${i + 1}`}`}
                        inputMode="numeric"
                        autoComplete="off"
                        maxLength={10}
                        placeholder="p. ej. 5256…"
                        spellCheck={false}
                        value={edicion.numeros[c.sacrificio_id]}
                        aria-invalid={!edicion.numeros[c.sacrificio_id] ? 'true' : undefined}
                        onChange={e => { const v = normalizarNumeroCanal(e.target.value); cambiar(ed => ({ ...ed, numeros: { ...ed.numeros, [c.sacrificio_id]: v } })); }}
                      />
                    ) : (c.numero_canal || <span className="rp-tenue">—</span>)}
                  </td>
                ))}
              </tr>
              <tr><th scope="row" className="sd-fija">Lote de deshuese</th>{canales.map(c => <td key={c.sacrificio_id} className="num rp-tenue">lo asigna la planta</td>)}</tr>
              <tr><th scope="row" className="sd-fija">Peso deshuese estimado ({pct} %)</th>{canales.map(c => <td key={c.sacrificio_id} className="num">{fmtKg(c.peso_deshuese_est)}</td>)}</tr>
              {canales.some(c => c.resultado_inspeccion && c.resultado_inspeccion !== 'aprobado') && (
                <tr>
                  <th scope="row" className="sd-fija">Inspección</th>
                  {canales.map(c => (
                    <td key={c.sacrificio_id} className="num">
                      {c.resultado_inspeccion && c.resultado_inspeccion !== 'aprobado'
                        ? <span className="badge badge-red"><CircleAlert size={12} aria-hidden="true" /> {c.resultado_inspeccion}</span>
                        : <span className="rp-tenue">aprobado</span>}
                    </td>
                  ))}
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {editable && <p className="rp-nota">El n.º de canal es el consecutivo de sacrificio de la planta. Se guarda también en el sacrificio y es obligatorio para marcar la solicitud como enviada.</p>}
      </section>

      {/* ── Matriz corte × canal ── */}
      <section className="card" aria-labelledby="sd-cortes">
        <div className="card-header">
          <h3 id="sd-cortes">Cortes a deshuesar <span className="sd-tenue-inline">medias canales por canal: 0, 1 o 2</span></h3>
          {editable && (
            <div className="rp-acciones">
              <Boton tamano="sm" onClick={() => setTodo(2)}>Todo en 2</Boton>
              <Boton tamano="sm" onClick={() => setTodo(0)}>Todo en 0</Boton>
            </div>
          )}
        </div>
        <div className="sd-scroll">
          <table className="sd-tabla sd-matriz">
            <thead>
              <tr>
                <th scope="col" className="sd-fija">Corte</th>
                <th scope="col">NAMP</th>
                {canales.map((c, i) => (
                  <th key={c.sacrificio_id} scope="col" className="num">
                    {c.arete || `Canal ${i + 1}`}
                    <span className="sd-tenue-bloque">{edicion.numeros[c.sacrificio_id] ? `canal ${edicion.numeros[c.sacrificio_id]}` : 'sin n.º'}</span>
                  </th>
                ))}
                {editable && <th scope="col"><span className="sr-only">Toda la fila</span></th>}
                <th scope="col">Observación</th>
              </tr>
            </thead>
            <tbody>
              {modelo.cortes.map(k => (
                <tr key={k.codigo}>
                  <th scope="row" className="sd-fija">
                    <span className="sd-codigo">{k.codigo}</span> {k.nombre || <span className="rp-tenue">fuera del catálogo</span>}
                    {k.nuevo && <span className="badge badge-orange sd-nuevo">nuevo</span>}
                  </th>
                  <td>{k.namp || <span className="rp-tenue">—</span>}</td>
                  {canales.map(c => {
                    const v = Number(edicion.medias[k.codigo]?.[c.sacrificio_id] ?? 0);
                    return (
                      <td key={c.sacrificio_id} className={`num ${v === 0 ? 'sd-cero' : ''}`}>
                        {editable ? (
                          <select
                            className="sd-select"
                            aria-label={`${k.nombre || k.codigo}, canal ${c.arete || c.sacrificio_id}: medias`}
                            value={v}
                            onChange={e => setMedia(k.codigo, c.sacrificio_id, Number(e.target.value))}
                          >
                            {MEDIAS.map(m => <option key={m} value={m}>{m}</option>)}
                          </select>
                        ) : v}
                      </td>
                    );
                  })}
                  {editable && (
                    <td className="sd-fila-acciones">
                      <button type="button" className="btn btn-secondary btn-sm" aria-label={`${k.nombre || k.codigo}: todas las canales en 2`} onClick={() => setFila(k.codigo, 2)}>2</button>
                      <button type="button" className="btn btn-secondary btn-sm" aria-label={`${k.nombre || k.codigo}: todas las canales en 0`} onClick={() => setFila(k.codigo, 0)}>0</button>
                    </td>
                  )}
                  <td>
                    {editable ? (
                      <input
                        className="sd-input-obs"
                        autoComplete="off"
                        aria-label={`Observación de ${k.nombre || k.codigo}`}
                        maxLength={300}
                        placeholder="p. ej. 0 para BCH…"
                        value={edicion.obs[k.codigo]}
                        onChange={e => { const v = e.target.value; cambiar(ed => ({ ...ed, obs: { ...ed.obs, [k.codigo]: v } })); }}
                      />
                    ) : (k.observacion || <span className="rp-tenue">—</span>)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" className="sd-fija">Total de medias</th>
                <td />
                {canales.map(c => <td key={c.sacrificio_id} className="num"><strong>{totales[c.sacrificio_id]}</strong></td>)}
                {editable && <td />}
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section className="card" aria-labelledby="sd-acciones">
        <h3 className="rp-subtitulo" id="sd-acciones">Observaciones y acciones</h3>
        <div className="form-group">
          <label htmlFor="sd-observaciones">Observaciones generales para la planta</label>
          {editable ? (
            <textarea id="sd-observaciones" rows={3} maxLength={1000} value={edicion.observaciones} onChange={e => { const v = e.target.value; cambiar(ed => ({ ...ed, observaciones: v })); }} />
          ) : <p id="sd-observaciones">{sol?.observaciones || <span className="rp-tenue">Sin observaciones</span>}</p>}
        </div>

        {errores.length > 0 && (
          <div className="banner error" role="alert" style={{ marginBottom: 12 }}>
            <CircleAlert size={18} aria-hidden="true" />
            <ul className="rp-lista-errores">{errores.map((e, i) => <li key={i}>{e}</li>)}</ul>
          </div>
        )}

        <div className="rp-acciones">
          {editable && (
            <Boton variante="primario" icono={Save} cargando={ocupado === 'guardar'} disabled={Boolean(ocupado) || (sol && !sucio)} onClick={() => guardar()}>
              {sol ? 'Guardar cambios' : 'Guardar borrador'}
            </Boton>
          )}
          {editable && (
            <>
              <label htmlFor="sd-enviada-a" className="sr-only">Enviada a</label>
              <input id="sd-enviada-a" name="enviada_a" autoComplete="off" className="sd-input-enviada" maxLength={200} value={enviadaA} onChange={e => setEnviadaA(e.target.value)} placeholder="Enviada a…" />
              <Boton icono={Send} cargando={ocupado === 'enviar'} disabled={Boolean(ocupado)} onClick={enviar}>Marcar como enviada</Boton>
            </>
          )}
          {(sol || editable) && (
            <Boton icono={Download} cargando={ocupado === 'excel'} disabled={Boolean(ocupado)} onClick={descargar}>Descargar Excel</Boton>
          )}
          {canEdit && sol?.estado === 'enviada' && (
            <>
              <Boton icono={RotateCcw} cargando={ocupado === 'reabrir'} disabled={Boolean(ocupado)} onClick={reabrir}>Reabrir para corregir</Boton>
              <Boton icono={CircleCheck} cargando={ocupado === 'deshuesada'} disabled={Boolean(ocupado)} onClick={deshuesada}>Marcar como deshuesada</Boton>
            </>
          )}
          {editable && sol && (
            <Boton variante="peligro" icono={Trash2} cargando={ocupado === 'eliminar'} disabled={Boolean(ocupado)} onClick={eliminar}>Eliminar borrador</Boton>
          )}
        </div>
        {editable && sucio && <p className="rp-nota" role="status">Hay cambios sin guardar.</p>}
        {editable && <p className="rp-nota">El envío por correo todavía no está disponible: descargue el Excel y mándelo a la planta.</p>}
      </section>
    </div>
  );
}
