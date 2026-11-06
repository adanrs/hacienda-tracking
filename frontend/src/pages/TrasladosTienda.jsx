import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CircleX, ClipboardCopy, MessageCircle, Printer, Send, Truck } from 'lucide-react';
import { api } from '../services/api';
import Boton from '../components/ui/Boton';
import { confirmar } from '../components/ui/confirmar';
import { aviso } from '../components/ui/avisos';
import { FilaEstado } from '../components/ui/Estados';
import { useAuth } from '../components/AuthContext';

/*
  Traslados de la planta (bodega 107) a la tienda (WC-01).
  Se crean marcando cajas en «Inventario de la planta». Acá se ve cada orden, se comparte la lista con
  la planta (imprimir, copiar o WhatsApp), se despacha y, cuando la tienda cierra su recepción por
  caja (evento traslado.recibido), se ve qué llegó, qué faltó, qué sobró y qué pesó distinto, con la
  acción y el motivo que registró la tienda y quién/cuándo de cada lado.
  Despachar es lo que «publica» el traslado: la tienda lo trae en su consulta a la integración.
*/
const n = (x, d = 2) => (x == null ? '—' : Number(x).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
const fecha = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—');
const ESTADO = { pendiente: 'badge-yellow', en_preparacion: 'badge-blue', despachada: 'badge-green', cancelada: 'badge-gray' };
const RECEPCION = {
  recibida: { texto: 'Recibida completa', clase: 'badge-green' },
  recibida_con_diferencias: { texto: 'Recibida con diferencias', clase: 'badge-orange' },
};
const RESULTADO = {
  recibida: { texto: 'Recibida', clase: 'badge-green' },
  otro_peso: { texto: 'Otro peso', clase: 'badge-orange' },
  faltante: { texto: 'Faltante', clase: 'badge-red' },
  sobrante: { texto: 'Sobrante', clase: 'badge-purple' },
};
const ACCION = { devolver_mismo_transporte: 'Devuelta en el mismo transporte', avisar_planta: 'Avisar a la planta' };

function EstadoRecepcion({ t }) {
  if (t.estado === 'cancelada') return <span className="badge badge-gray">anulada</span>;
  if (t.recepcion_estado) {
    const r = RECEPCION[t.recepcion_estado];
    return <span className={`badge ${r.clase}`}>{r.texto}</span>;
  }
  if (t.estado === 'despachada') return <span className="badge badge-blue">En camino a la tienda</span>;
  return <span className="badge badge-yellow">Por despachar</span>;
}

function Lista() {
  const [lista, setLista] = useState(null);
  const [error, setError] = useState('');
  const cargar = useCallback(() => {
    setError('');
    api.getTrasladosTienda().then(setLista).catch(e => { setError(e.message); setLista([]); });
  }, []);
  useEffect(() => { cargar(); }, [cargar]);
  return (
    <div className="card">
      <div className="table-container">
        <table>
          <thead><tr><th>Número</th><th>Fecha</th><th>Pide</th><th className="num">Cajas</th><th className="num">Kg</th><th>Estado</th><th>Recepción en la tienda</th></tr></thead>
          <tbody>
            <FilaEstado columnas={7} cargando={lista === null} error={error} onReintentar={cargar} vacio={lista && !lista.length}
              tituloVacio="Todavía no hay traslados a la tienda"
              textoVacio="Se crean en «Inventario de la planta»: marque las cajas que quiere la tienda y use «Pedir a la tienda»." />
            {(lista || []).map(t => (
              <tr key={t.id}>
                <td><Link to={`/traslados-tienda/${t.id}`}><strong>{t.numero}</strong></Link>{t.es_prueba && <> <span className="badge badge-purple">PRUEBA</span></>}</td>
                <td>{fecha(t.fecha)}</td>
                <td>{t.solicitante || '—'}</td>
                <td className="num">{t.cajas}</td>
                <td className="num">{n(t.kg)}</td>
                <td><span className={`badge ${ESTADO[t.estado] || 'badge-gray'}`}>{t.estado}</span></td>
                <td><EstadoRecepcion t={t} />{t.recepcion_en ? ` ${t.recepcion_en}` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Detalle({ id }) {
  const { canEdit } = useAuth();
  const navigate = useNavigate();
  const [t, setT] = useState(null);
  const [error, setError] = useState('');
  const [trabajando, setTrabajando] = useState(false);
  const cargar = useCallback(() => {
    setError('');
    api.getTrasladoTienda(id).then(setT).catch(e => setError(e.message));
  }, [id]);
  useEffect(() => { cargar(); }, [cargar]);

  if (error) return <div className="card"><div className="banner error" role="alert">{error}</div><Boton onClick={cargar}>Reintentar</Boton></div>;
  if (!t) return <div className="card"><p className="rp-tenue">Cargando…</p></div>;

  const kg = t.items.reduce((s, i) => s + Number(i.peso_kg || 0), 0);
  const vivo = t.estado !== 'despachada' && t.estado !== 'cancelada';
  const despachar = async () => {
    if (!(await confirmar({ titulo: `¿Despachar ${t.numero}?`, mensaje: 'Confirme cuando la planta ya cargó las cajas en el transporte. Al despacharla, la tienda la ve en «Traslados por recibir».', textoConfirmar: 'Despachar' }))) return;
    setTrabajando(true);
    try { await api.despacharOrden(t.id); aviso.ok('Traslado despachado: la tienda ya lo puede recibir'); cargar(); } catch (e) { aviso.error(e.message); } finally { setTrabajando(false); }
  };
  const anular = async () => {
    if (!(await confirmar({ titulo: `¿Anular ${t.numero}?`, mensaje: 'Las cajas vuelven a quedar disponibles para otro traslado.', textoConfirmar: 'Anular', textoCancelar: 'Volver', peligro: true }))) return;
    setTrabajando(true);
    try { await api.updateOrdenSalida(t.id, { estado: 'cancelada' }); aviso.ok('Traslado anulado'); cargar(); } catch (e) { aviso.error(e.message); } finally { setTrabajando(false); }
  };
  const copiar = async () => {
    try { await navigator.clipboard.writeText(t.texto_planta); aviso.ok('Lista copiada: péguela en el correo o el chat con la planta'); } catch { aviso.error('No se pudo copiar: seleccione el texto de abajo'); }
  };
  // Ventana aparte solo con la lista: la planta la usa impresa para buscar cada caja.
  const imprimir = () => {
    const w = window.open('', '_blank', 'noopener=no,width=800,height=900');
    if (!w) { aviso.error('El navegador bloqueó la ventana de impresión'); return; }
    const doc = w.document;
    doc.title = `Traslado ${t.numero}`;
    const pre = doc.createElement('pre');
    pre.style.cssText = 'font: 13px/1.5 ui-monospace, Consolas, monospace; white-space: pre-wrap; margin: 24px;';
    pre.textContent = t.texto_planta;
    doc.body.appendChild(pre);
    w.focus();
    w.print();
  };

  return (
    <>
      <div className="card">
        <div className="card-header">
          <h3>{t.numero} {t.es_prueba && <span className="badge badge-purple">PRUEBA</span>} <EstadoRecepcion t={t} /></h3>
          <div className="rp-acciones">
            <Boton icono={Printer} onClick={imprimir}>Imprimir lista</Boton>
            <Boton icono={ClipboardCopy} onClick={copiar}>Copiar lista</Boton>
            <a className="btn btn-secondary" href={`https://wa.me/?text=${encodeURIComponent(t.texto_planta)}`} target="_blank" rel="noopener noreferrer">
              <MessageCircle size={16} aria-hidden="true" /> WhatsApp
            </a>
            {canEdit && vivo && <Boton variante="primario" icono={Send} cargando={trabajando} onClick={despachar}>Despachar</Boton>}
            {canEdit && vivo && <Boton variante="peligro" icono={CircleX} disabled={trabajando} onClick={anular}>Anular</Boton>}
          </div>
        </div>
        <dl className="imp-resumen">
          <div className="imp-dato"><dt>Fecha</dt><dd>{fecha(t.fecha)}</dd></div>
          <div className="imp-dato"><dt>Pide</dt><dd>{t.solicitante || '—'}</dd></div>
          <div className="imp-dato"><dt>De → a</dt><dd>{t.origen_codigo || '—'} → {t.destino_codigo}</dd></div>
          <div className="imp-dato"><dt>Cajas</dt><dd>{t.items.length}</dd></div>
          <div className="imp-dato"><dt>Kg</dt><dd>{n(kg)}</dd></div>
          <div className="imp-dato"><dt>Despachada</dt><dd>{t.despachada_en || '—'}</dd></div>
        </dl>
        {t.notas && <p className="rp-nota">Notas: {t.notas}</p>}
        <div className="table-container">
          <table className="tabla-compacta">
            <thead><tr><th>Código</th><th>Descripción</th><th>Código de barras de la caja</th><th className="num">Kg</th><th>Lote</th><th className="num">BMS</th><th>Arete</th></tr></thead>
            <tbody>
              {t.items.map(i => (
                <tr key={i.id}>
                  <td><strong>{i.codigo_articulo || '—'}</strong></td>
                  <td>{i.descripcion || '—'}</td>
                  <td style={{ fontFamily: 'ui-monospace, Consolas, monospace' }}>{i.codigo_barras || i.caja_codigo || '—'}</td>
                  <td className="num">{n(i.peso_kg, 3)}</td>
                  <td>{i.lote || '—'}</td>
                  <td className="num">{i.bms ?? '—'}</td>
                  <td>{i.arete || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <details style={{ marginTop: 'var(--esp-3)' }}>
          <summary>Texto para la planta</summary>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 'var(--texto-sm)' }}>{t.texto_planta}</pre>
        </details>
      </div>

      <div className="card">
        <h3><Truck size={20} aria-hidden="true" /> Recepción en la tienda</h3>
        {!t.recepciones.length && (
          <p className="rp-tenue">
            {t.estado === 'despachada'
              ? 'Despachado. La tienda lo recibe caja por caja en su panel («Traslados por recibir») y al cerrar la recepción el resultado aparece aquí.'
              : 'Cuando la planta cargue las cajas, use «Despachar». Recién entonces la tienda lo ve.'}
          </p>
        )}
        {t.recepciones.map(r => (
          <div key={r.id} style={{ marginBottom: 'var(--esp-4)' }}>
            <p className="rp-nota">
              <span className={`badge ${RECEPCION[r.estado].clase}`}>{RECEPCION[r.estado].texto}</span>
              {' '}Cerró la tienda: <strong>{r.recibida_por || '—'}</strong> el {r.cerrada_en || '—'} · llegó a ganadería el {r.registrada_en}
              {' · '}{r.cajas_recibidas} recibida(s), {r.cajas_faltantes} faltante(s), {r.cajas_sobrantes} sobrante(s), {r.cajas_otro_peso} con otro peso
              {' · '}{n(r.kg_recibido)} de {n(r.kg_esperado)} kg
            </p>
            <div className="table-container">
              <table className="tabla-compacta">
                <thead><tr><th>Caja</th><th>Resultado</th><th className="num">Kg esperado</th><th className="num">Kg recibido</th><th>Acción</th><th>Motivo</th></tr></thead>
                <tbody>
                  {r.cajas.map((c, k) => (
                    <tr key={k}>
                      <td style={{ fontFamily: 'ui-monospace, Consolas, monospace' }}>{c.codigo}</td>
                      <td><span className={`badge ${RESULTADO[c.resultado].clase}`}>{RESULTADO[c.resultado].texto}</span></td>
                      <td className="num">{n(c.kg_esperado, 3)}</td>
                      <td className="num">{n(c.kg_recibido, 3)}</td>
                      <td>{ACCION[c.accion] || '—'}</td>
                      <td>{c.motivo || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
      <Boton icono={ArrowLeft} onClick={() => navigate('/traslados-tienda')}>Todos los traslados</Boton>
    </>
  );
}

export default function TrasladosTienda() {
  const { id } = useParams();
  return (
    <div>
      <div className="page-header">
        <h2>Traslados a la tienda</h2>
        {!id && <Link className="btn btn-primary" to="/inventario-planta"><Truck size={18} aria-hidden="true" /> Pedir cajas del inventario</Link>}
      </div>
      <p className="rp-nota">De la bodega 107 (producto terminado en CIISA) a la tienda Wagyu Cross (WC-01). Unos 1 por semana; los piden Carolina, Michelle o Juan Carlos.</p>
      {id ? <Detalle id={id} /> : <Lista />}
    </div>
  );
}
