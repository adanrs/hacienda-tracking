import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, ClipboardPaste, FileSpreadsheet, RefreshCw, Truck, Upload } from 'lucide-react';
import { api } from '../services/api';
import Boton from '../components/ui/Boton';
import { confirmar } from '../components/ui/confirmar';
import { aviso } from '../components/ui/avisos';
import { FilaEstado } from '../components/ui/Estados';
import { useAuth } from '../components/AuthContext';
import VistaPrevia from '../components/importador/VistaPrevia';
import ResumenPlan from '../components/importador/ResumenPlan';
import useImportacion from '../components/importador/useImportacion';
import AltaRapidaCorte from '../components/AltaRapidaCorte';
import Modal from '../components/ui/Modal';

/*
  Inventario semanal que manda la planta CIISA (Excel «INV WAGYU SEMANA nn», bodega 107 / paquetería).
  Arriba se carga (subir el .xlsx o pegar la tabla) con vista previa: avisos por línea, totales por hoja,
  códigos fuera del catálogo (alta rápida) y cuánto cambia contra el último snapshot. Abajo se consulta
  el snapshot (por omisión el último) con filtros, y las altas/bajas contra el anterior.
  Cada carga es una foto: no cambia cajas, primales ni custodia de la app.
  Traslado a la tienda (Juan Carlos, 05/06-nov-2026): en el último snapshot se marcan las cajas de
  «INV GENERAL» que quiere la tienda y se genera la orden 107 → WC-01 (reemplaza el Excel que iba y
  volvía con la planta). Una caja que ya está en un traslado vivo no se puede marcar otra vez.
*/
const n = (x, d = 2) => (x == null ? '—' : Number(x).toLocaleString('en-US', { maximumFractionDigits: d }));
const fecha = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—');
const HOJA = { general: 'INV GENERAL', maduracion: 'MADURACIÓN' };
const TRAZ = {
  con_arete: { texto: 'Con arete', clase: 'badge-green' },
  recuperada: { texto: 'Recuperada', clase: 'badge-blue' },
  sin_trazabilidad: { texto: 'Sin trazabilidad', clase: 'badge-orange' },
  na: { texto: 'Sin código', clase: 'badge-gray' },
};
const BadgeTraz = ({ estado, titulo }) => {
  const t = TRAZ[estado] || TRAZ.na;
  return <span className={`badge ${t.clase}`} title={titulo || undefined}>{t.texto}</span>;
};

/** Tarjetas de totales de un snapshot o de la vista previa, por hoja. */
function Totales({ totales }) {
  const hojas = Object.entries(totales || {});
  if (!hojas.length) return null;
  return hojas.map(([hoja, t]) => (
    <div key={hoja} style={{ marginBottom: 'var(--esp-3)' }}>
      <h4 style={{ margin: 'var(--esp-3) 0 0' }}>{HOJA[hoja] || hoja}</h4>
      <dl className="imp-resumen">
        <div className="imp-dato"><dt>Piezas</dt><dd>{n(t.piezas, 0)}</dd></div>
        <div className="imp-dato"><dt>Kg</dt><dd>{n(t.kg)}</dd></div>
        {Object.entries(t.no_kg || {}).map(([m, v]) => <div key={m} className="imp-dato"><dt>{m} (no suma kg)</dt><dd>{n(v)}</dd></div>)}
        <div className="imp-dato"><dt>Tarimas</dt><dd>{t.tarimas}</dd></div>
        <div className="imp-dato imp-ok"><dt>Con trazabilidad</dt><dd>{t.pct_con_trazabilidad ?? 0} %</dd></div>
        <div className="imp-dato"><dt>Con arete</dt><dd>{t.trazabilidad.con_arete} ({t.pct_con_arete ?? 0} %)</dd></div>
        <div className="imp-dato imp-info"><dt>Recuperada</dt><dd>{t.trazabilidad.recuperada} ({t.pct_recuperada ?? 0} %)</dd></div>
        <div className={`imp-dato ${t.trazabilidad.sin_trazabilidad ? 'imp-alerta' : ''}`}><dt>Sin trazabilidad</dt><dd>{t.trazabilidad.sin_trazabilidad} ({t.pct_sin_trazabilidad ?? 0} %)</dd></div>
        <div className="imp-dato"><dt>Sin código</dt><dd>{t.trazabilidad.na}</dd></div>
        <div className={`imp-dato ${t.vencidos ? 'imp-error' : ''}`}><dt>Vencidos</dt><dd>{t.vencidos} · {n(t.kg_vencidos)} kg</dd></div>
      </dl>
    </div>
  ));
}

// BMS de la caja (2 últimos dígitos del código, Juan Carlos 06-nov-2026) y, si la línea trazó a un
// animal con marmoleo medido en la canal, si cuadra. «No cuadra» es un aviso, no frena nada.
function Bms({ bms, estado, animal, aviso }) {
  if (bms == null) return '—';
  if (estado === 'no_cuadra') {
    return (
      <span title={aviso || `El animal tiene marmoleo AUS-MEAT ${animal}`}>
        <strong>{bms}</strong> <span className="badge badge-orange">≠ animal {animal}</span>
      </span>
    );
  }
  const titulo = estado === 'coincide' ? `Coincide con el marmoleo del animal (${animal})`
    : estado === 'no_comparable' ? `El animal tiene AUS-MEAT ${animal}: un BMS mayor a 9 no se compara sin tabla de conversión` : undefined;
  return <span title={titulo}>{bms}{estado === 'coincide' ? ' ✓' : ''}</span>;
}

const COLUMNAS_PLAN = [
  { titulo: 'Hoja', valor: f => HOJA[f.hoja] || f.hoja },
  { titulo: 'Tarima', valor: f => f.tarima || '—' },
  { titulo: 'Código', valor: f => <strong>{f.codigo || '—'}</strong> },
  { titulo: 'Descripción', valor: f => f.descripcion || '—' },
  { titulo: 'Peso', num: true, valor: f => `${n(f.peso, 3)}${f.medida && !/^kil/i.test(f.medida) ? ` ${f.medida}` : ''}` },
  { titulo: 'Lote / caja', valor: f => `${f.lote || '—'}${f.caja ? ` · caja ${f.caja}` : ''}` },
  { titulo: 'Vence', valor: f => <span style={f.vencido ? { color: 'var(--error-fuerte)', fontWeight: 600 } : {}}>{fecha(f.fecha_vencimiento)}{f.vencido ? ' (vencido)' : ''}</span> },
  { titulo: 'Trazabilidad', valor: f => <span><BadgeTraz estado={f.trazabilidad} titulo={f.traz_motivo} />{f.arete ? ` ${f.arete}` : ''}</span> },
  { titulo: 'BMS', num: true, valor: f => <Bms bms={f.bms} estado={f.bms_estado} animal={f.bms_animal} /> },
];

function CargarInventario({ onAplicado }) {
  const { canEdit } = useAuth();
  const refArchivo = useRef(null);
  const [pegado, setPegado] = useState('');
  const [fechaInv, setFechaInv] = useState('');
  const [alta, setAlta] = useState(null);
  const imp = useImportacion('inventario-ciisa');
  const { plan } = imp;
  const opciones = (extra = {}) => ({ fecha_inventario: fechaInv || undefined, ...extra });

  const elegir = async (e) => {
    const a = e.target.files?.[0];
    e.target.value = '';
    if (!a) return;
    if (a.size > 10 * 1024 * 1024) { aviso.error('El archivo pesa más de 10 MB'); return; }
    await imp.planificar({ archivo: a }, opciones());
  };
  const leerPegado = () => {
    if (!pegado.trim()) { aviso.error('Pegue la tabla (con su fila de encabezados) primero'); return; }
    imp.planificar({ pegado: { texto: pegado } }, opciones());
  };
  const aplicar = async () => {
    const ok = await confirmar({
      titulo: plan.carga_existente ? 'Este inventario ya estaba cargado' : '¿Guardar el snapshot del inventario?',
      mensaje: plan.carga_existente
        ? `El mismo contenido se cargó el ${plan.carga_existente.fecha_carga}: no se crea otro snapshot.`
        : `Se guardan ${plan.resumen.nuevos} línea(s).${plan.resumen.errores ? ` ${plan.resumen.errores} con error NO se guardan.` : ''}`,
      textoConfirmar: plan.carga_existente ? 'Entendido' : 'Guardar snapshot',
    });
    if (!ok || plan.carga_existente) return;
    const r = await imp.aplicar();
    if (r) { aviso.ok('Inventario de la planta guardado'); onAplicado(r.resultado.resumen.carga_id); }
  };

  return (
    <>
      <div className="grid-2">
        <div className="card">
          <h3 className="rp-subtitulo"><FileSpreadsheet size={20} aria-hidden="true" /> Subir el Excel de la planta</h3>
          <p className="rp-nota">Se leen solo las hojas «INV GENERAL» y «MADURACION»; las de cada tarima y las tortas son vistas parciales y se ignoran.</p>
          <div className="form-group">
            <label htmlFor="inv-fecha">Fecha del inventario (opcional)</label>
            <input id="inv-fecha" type="date" value={fechaInv} onChange={e => setFechaInv(e.target.value)} />
            <small className="rp-tenue">La planta no la pone en el archivo. Si la hoja no trae «Vencido», se calcula contra esta fecha (o hoy).</small>
          </div>
          <div className="rp-acciones">
            <Boton variante="primario" icono={Upload} cargando={imp.cargando} disabled={!canEdit} onClick={() => refArchivo.current?.click()}>Elegir Excel…</Boton>
            {plan && <Boton icono={RefreshCw} onClick={() => imp.replanificar(opciones())} cargando={imp.cargando}>Volver a revisar</Boton>}
          </div>
          <input ref={refArchivo} type="file" accept=".xlsx" onChange={elegir} hidden />
        </div>
        <div className="card">
          <h3 className="rp-subtitulo"><ClipboardPaste size={20} aria-hidden="true" /> O pegar la tabla</h3>
          <p className="rp-nota">En Excel seleccione la tabla de una hoja con sus encabezados (INV GENERAL o MADURACION), cópiela y péguela aquí.</p>
          <label htmlFor="inv-pegado" className="sr-only">Tabla pegada</label>
          <textarea id="inv-pegado" rows={5} className="imp-pegado" value={pegado} disabled={!canEdit}
            placeholder="Tarima · Linea · Cod Barra · Codigo · Descripción · Peso · Medida · Lote · Fecha Vencimiento…"
            onChange={e => setPegado(e.target.value)} />
          <Boton icono={RefreshCw} onClick={leerPegado} cargando={imp.cargando} disabled={!canEdit}>Leer lo pegado</Boton>
        </div>
      </div>

      {plan && (
        <div className="card">
          <div className="card-header">
            <h3>Vista previa · {plan.archivo_nombre || 'tabla pegada'}</h3>
            <div className="rp-acciones">
              <Boton variante="primario" icono={CheckCircle2} cargando={imp.aplicando}
                disabled={!canEdit || plan.errores_generales?.length > 0 || (!plan.carga_existente && plan.resumen.nuevos === 0)}
                onClick={aplicar}>
                Guardar snapshot
              </Boton>
            </div>
          </div>
          {plan.errores_generales?.length > 0 && <div className="banner error" role="alert">{plan.errores_generales.join(' ')}</div>}
          {plan.carga_existente && <div className="banner info" role="status">Este inventario ya está cargado (snapshot del {plan.carga_existente.fecha_carga}): no se crea otro.</div>}
          <p className="rp-nota">
            Hojas leídas: {plan.hojas_leidas.map(h => `${h.nombre} (${h.lineas})`).join(', ') || 'ninguna'}
            {plan.hojas_ignoradas.length > 0 && ` · ignoradas: ${plan.hojas_ignoradas.length}`}
            {' · '}vencido según {plan.fecha_inventario ? `el ${fecha(plan.fecha_inventario)}` : `el archivo o hoy (${fecha(plan.vencido_referencia)})`}
          </p>
          {plan.comparacion_previa && (
            <div className="banner info" role="status">
              Contra el último snapshot ({plan.comparacion_previa.fecha_inventario ? `inventario del ${fecha(plan.comparacion_previa.fecha_inventario)}` : `cargado el ${plan.comparacion_previa.fecha_carga}`}):
              {' '}<strong>{plan.comparacion_previa.altas}</strong> línea(s) nuevas y <strong>{plan.comparacion_previa.bajas}</strong> que ya no están.
            </div>
          )}
          <ResumenPlan resumen={plan.resumen} />
          <Totales totales={plan.totales} />
          {plan.codigos_fuera_catalogo.length > 0 && (
            <div className="banner info" role="status" style={{ display: 'block' }}>
              <strong>Códigos que no están en el catálogo de cortes</strong> (se guardan igual; puede darlos de alta o dejarlos para «pendientes de codificar» con el 99):
              <ul style={{ margin: 'var(--esp-2) 0 0' }}>
                {plan.codigos_fuera_catalogo.map(c => (
                  <li key={c.codigo}>
                    {c.codigo} · {c.descripcion || 'sin descripción'} · {c.lineas} línea(s)
                    {canEdit && <> {' '}<button type="button" className="btn btn-secondary btn-sm" onClick={() => setAlta(c)}>Alta rápida</button></>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <VistaPrevia key={plan.huella} filas={plan.filas} columnas={COLUMNAS_PLAN} filtroInicial="todas" />
        </div>
      )}
      {alta && (
        <AltaRapidaCorte codigo={alta.codigo} descripcion={alta.descripcion || ''} onCerrar={() => setAlta(null)}
          onCreado={() => { setAlta(null); imp.replanificar(opciones()); }} />
      )}
    </>
  );
}

const POR_PAGINA = 50;
// Quienes piden los traslados hoy (JC, 06-nov-2026). Es una sugerencia: el campo es libre.
const SOLICITANTES = ['Carolina', 'Michelle', 'Juan Carlos'];

/** Ventana para confirmar el traslado de las cajas marcadas. */
function PedirTraslado({ lineas, onCerrar, onCreado }) {
  const [form, setForm] = useState({ solicitante: '', fecha: new Date().toISOString().slice(0, 10), notas: '', es_prueba: false });
  const [enviando, setEnviando] = useState(false);
  const kg = lineas.reduce((s, l) => s + Number(l.peso || 0), 0);
  const porProducto = [...lineas.reduce((m, l) => {
    const k = `${l.codigo || '—'} ${l.descripcion || ''}`.trim();
    const x = m.get(k) || { cajas: 0, kg: 0 };
    m.set(k, { cajas: x.cajas + 1, kg: x.kg + Number(l.peso || 0) });
    return m;
  }, new Map())];
  const enviar = async (e) => {
    e.preventDefault();
    if (!form.solicitante.trim()) { aviso.error('Indique quién pide el traslado'); return; }
    setEnviando(true);
    try {
      const r = await api.crearTrasladoTienda({ ...form, linea_ids: lineas.map(l => l.id) });
      if (r.avisos?.length) aviso.info(`${r.avisos.length} caja(s) tienen el mismo código que otro traslado vivo: revise que no sea la misma caja`);
      aviso.ok(`Traslado ${r.numero} creado: ${r.cajas} caja(s)`);
      onCreado(r);
    } catch (err) { aviso.error(err.message); } finally { setEnviando(false); }
  };
  return (
    <Modal titulo="Pedir cajas a la tienda (107 → WC-01)" icono={Truck} onCerrar={onCerrar} ancho="ancho"
      acciones={<><Boton onClick={onCerrar}>Volver</Boton><Boton variante="primario" type="submit" form="f-traslado" icono={Truck} cargando={enviando}>Generar orden de traslado</Boton></>}>
      <form id="f-traslado" onSubmit={enviar}>
        <p className="rp-nota"><strong>{lineas.length}</strong> caja(s) · <strong>{n(kg)}</strong> kg. La planta las busca por el código de barras y las manda completas, sin abrir.</p>
        <ul style={{ margin: '0 0 var(--esp-3)' }}>
          {porProducto.map(([k, x]) => <li key={k}>{k}: {x.cajas} caja(s) · {n(x.kg)} kg</li>)}
        </ul>
        <div className="form-row">
          <div className="form-group">
            <label htmlFor="tr-solicitante">Quién pide *</label>
            <input id="tr-solicitante" list="tr-solicitantes" required value={form.solicitante} maxLength={80} onChange={e => setForm({ ...form, solicitante: e.target.value })} />
            <datalist id="tr-solicitantes">{SOLICITANTES.map(x => <option key={x} value={x} />)}</datalist>
          </div>
          <div className="form-group">
            <label htmlFor="tr-fecha">Fecha</label>
            <input id="tr-fecha" type="date" value={form.fecha} onChange={e => setForm({ ...form, fecha: e.target.value })} />
          </div>
        </div>
        <div className="form-group">
          <label htmlFor="tr-notas">Notas para la planta</label>
          <textarea id="tr-notas" rows={2} maxLength={500} value={form.notas} onChange={e => setForm({ ...form, notas: e.target.value })} />
        </div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="checkbox" checked={form.es_prueba} onChange={e => setForm({ ...form, es_prueba: e.target.checked })} />
          Traslado de PRUEBA (no es un pedido real; se borra con el script de prueba)
        </label>
      </form>
    </Modal>
  );
}

function Snapshot({ recarga }) {
  const { canEdit } = useAuth();
  const navigate = useNavigate();
  const [marcadas, setMarcadas] = useState(() => new Set());
  const [pidiendo, setPidiendo] = useState(false);
  const [cargas, setCargas] = useState(null);
  const [cargaId, setCargaId] = useState('');
  const [filtro, setFiltro] = useState({ hoja: '', tarima: '', codigo: '', trazabilidad: '', vencidos: '', q: '' });
  const [datos, setDatos] = useState(null);
  const [comp, setComp] = useState(null);
  const [error, setError] = useState('');
  const [pagina, setPagina] = useState(0);

  useEffect(() => { api.getInventarioPlantaCargas().then(setCargas).catch(() => setCargas([])); }, [recarga]);
  useEffect(() => { if (recarga) setCargaId(String(recarga)); }, [recarga]);

  const cargar = useCallback(async () => {
    setError('');
    try {
      const d = await api.getInventarioPlantaLineas({ carga_id: cargaId || undefined, ...filtro });
      setDatos(d);
      setPagina(0);
    } catch (e) { setError(e.message); setDatos(null); }
  }, [cargaId, filtro]);
  useEffect(() => { cargar(); }, [cargar, recarga]);
  useEffect(() => {
    api.getInventarioPlantaComparacion({ carga_id: cargaId || undefined }).then(setComp).catch(() => setComp(null));
  }, [cargaId, recarga]);

  const lineas = useMemo(() => datos?.lineas || [], [datos]);
  // Solo se piden cajas del ÚLTIMO snapshot (el backend lo exige): el de antes ya no dice qué hay.
  // El backend dice si es el último de su clase (real o PRUEBA): la carga del seed no tapa el real.
  const esUltimo = Boolean(datos?.carga?.es_ultima);
  const pedible = (l) => canEdit && esUltimo && l.hoja === 'general' && Boolean(l.codigo_barras) && !l.traslado_numero;
  const lineasMarcadas = lineas.filter(l => marcadas.has(l.id));
  const alternar = (id) => setMarcadas(m => { const x = new Set(m); if (x.has(id)) x.delete(id); else x.add(id); return x; });
  useEffect(() => { setMarcadas(new Set()); }, [cargaId, recarga]);
  const paginas = Math.max(1, Math.ceil(lineas.length / POR_PAGINA));
  const pag = Math.min(pagina, paginas - 1);
  const set = (k) => (e) => setFiltro(f => ({ ...f, [k]: e.target.value }));

  if (cargas && !cargas.length) {
    return <div className="card"><h3>Snapshot del inventario</h3><p className="rp-tenue">Todavía no se ha cargado ningún inventario de la planta.</p></div>;
  }
  const carga = datos?.carga;
  const resumenCarga = carga && (typeof carga.resumen === 'string' ? JSON.parse(carga.resumen) : carga.resumen);

  return (
    <>
      <div className="card">
        <div className="card-header">
          <h3>Snapshot {carga ? `n.º ${carga.id} · ${carga.fecha_inventario ? `inventario del ${fecha(carga.fecha_inventario)}` : `cargado el ${carga.fecha_carga}`}` : ''}</h3>
          <div className="form-group" style={{ margin: 0 }}>
            <label htmlFor="inv-carga" className="sr-only">Snapshot</label>
            <select id="inv-carga" value={cargaId} onChange={e => setCargaId(e.target.value)}>
              <option value="">El último</option>
              {(cargas || []).map(c => <option key={c.id} value={c.id}>{c.es_prueba ? 'PRUEBA · ' : ''}n.º {c.id} · {c.fecha_inventario ? fecha(c.fecha_inventario) : c.fecha_carga} · {c.archivo || 'pegado'} · {c.lineas} líneas</option>)}
            </select>
          </div>
        </div>
        {carga && <p className="rp-nota">Archivo: {carga.archivo || 'tabla pegada'} · cargado el {carga.fecha_carga}{carga.quien ? ` por ${carga.quien}` : ''}</p>}
        {resumenCarga?.totales && <Totales totales={resumenCarga.totales} />}

        <div className="sel-filtros" style={{ marginBottom: 12 }}>
          <div className="form-group"><label htmlFor="inv-hoja">Hoja</label>
            <select id="inv-hoja" value={filtro.hoja} onChange={set('hoja')}><option value="">Todas</option><option value="general">INV GENERAL</option><option value="maduracion">Maduración</option></select></div>
          <div className="form-group"><label htmlFor="inv-tarima">Tarima</label>
            <select id="inv-tarima" value={filtro.tarima} onChange={set('tarima')}><option value="">Todas</option>{(datos?.tarimas || []).map(t => <option key={t} value={t}>{t}</option>)}</select></div>
          <div className="form-group"><label htmlFor="inv-codigo">Código</label><input id="inv-codigo" value={filtro.codigo} onChange={set('codigo')} placeholder="26617" inputMode="numeric" /></div>
          <div className="form-group"><label htmlFor="inv-traz">Trazabilidad</label>
            <select id="inv-traz" value={filtro.trazabilidad} onChange={set('trazabilidad')}><option value="">Todas</option>{Object.entries(TRAZ).map(([k, t]) => <option key={k} value={k}>{t.texto}</option>)}</select></div>
          <div className="form-group"><label htmlFor="inv-venc">Vencimiento</label>
            <select id="inv-venc" value={filtro.vencidos} onChange={set('vencidos')}><option value="">Todos</option><option value="1">Solo vencidos</option></select></div>
          <div className="form-group"><label htmlFor="inv-q">Buscar</label><input id="inv-q" value={filtro.q} onChange={set('q')} placeholder="descripción, lote, caja, arete" /></div>
        </div>
        {datos && <p className="rp-nota">{n(datos.filtradas, 0)} línea(s) con este filtro · {n(Object.values(datos.totales || {}).reduce((s, t) => s + t.kg, 0))} kg{datos.truncado ? ' · se muestran las primeras 5,000: afine el filtro' : ''}</p>}
        <div className="table-container">
          <table className="tabla-compacta">
            <thead><tr><th><span className="sr-only">Pedir</span></th><th>Hoja</th><th>Tarima</th><th>Código</th><th>Descripción</th><th className="num">Peso</th><th>Lote</th><th>Caja / código de barras</th><th>Vence</th><th>Trazabilidad</th><th className="num">BMS</th><th>Estatus / despacho</th><th>Traslado</th></tr></thead>
            <tbody>
              <FilaEstado columnas={13} cargando={!datos && !error} error={error} vacio={datos && !lineas.length} onReintentar={cargar} tituloVacio="Sin líneas con ese filtro" />
              {lineas.slice(pag * POR_PAGINA, (pag + 1) * POR_PAGINA).map(l => (
                <tr key={l.id} className={marcadas.has(l.id) ? 'fila-seleccionada' : undefined}>
                  <td>
                    {pedible(l) && (
                      <input type="checkbox" checked={marcadas.has(l.id)} onChange={() => alternar(l.id)}
                        aria-label={`Pedir la caja ${l.codigo_barras} a la tienda`} />
                    )}
                  </td>
                  <td>{HOJA[l.hoja]}</td>
                  <td>{l.tarima || '—'}</td>
                  <td><strong>{l.codigo || '—'}</strong></td>
                  <td>{l.descripcion || '—'}</td>
                  <td className="num">{n(l.peso, 3)}{l.medida && !/^kil/i.test(l.medida) ? ` ${l.medida}` : ''}</td>
                  <td>{l.lote || '—'}</td>
                  <td style={{ fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 'var(--texto-sm)' }}>{l.caja ? `caja ${l.caja}` : l.codigo_barras || 'sin código'}</td>
                  <td style={l.vencido ? { color: 'var(--error-fuerte)', fontWeight: 600 } : {}}>{fecha(l.fecha_vencimiento)}{l.vencido ? ' (vencido)' : ''}</td>
                  <td><BadgeTraz estado={l.trazabilidad} />{l.arete ? ` ${l.arete}` : ''}</td>
                  <td className="num"><Bms bms={l.bms} estado={l.bms_estado} animal={l.bms_animal} aviso={l.bms_aviso} /></td>
                  <td>{[l.estatus, l.despacho, l.pedido_por, l.orden].filter(Boolean).join(' · ') || '—'}</td>
                  <td>{l.traslado_numero ? <span className="badge badge-blue">{l.traslado_numero}</span> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {canEdit && esUltimo && (
          <div className="rp-acciones" style={{ marginTop: 'var(--esp-3)', alignItems: 'center' }} role="status">
            <span>{lineasMarcadas.length
              ? <><strong>{lineasMarcadas.length}</strong> caja(s) marcadas · {n(lineasMarcadas.reduce((s, l) => s + Number(l.peso || 0), 0))} kg</>
              : 'Marque las cajas de INV GENERAL que quiere la tienda.'}</span>
            <Boton variante="primario" icono={Truck} disabled={!lineasMarcadas.length} onClick={() => setPidiendo(true)}>Pedir a la tienda…</Boton>
            {lineasMarcadas.length > 0 && <Boton onClick={() => setMarcadas(new Set())}>Desmarcar</Boton>}
          </div>
        )}
        {pidiendo && (
          <PedirTraslado lineas={lineasMarcadas} onCerrar={() => setPidiendo(false)}
            onCreado={(r) => { setPidiendo(false); setMarcadas(new Set()); navigate(`/traslados-tienda/${r.id}`); }} />
        )}
        {paginas > 1 && (
          <nav className="rp-acciones" aria-label="Páginas del inventario" style={{ marginTop: 'var(--esp-3)' }}>
            <button type="button" className="btn btn-secondary btn-sm" disabled={pag === 0} onClick={() => setPagina(pag - 1)}>Anterior</button>
            <span>Página {pag + 1} de {paginas}</span>
            <button type="button" className="btn btn-secondary btn-sm" disabled={pag >= paginas - 1} onClick={() => setPagina(pag + 1)}>Siguiente</button>
          </nav>
        )}
      </div>

      {comp?.anterior && (
        <div className="card">
          <h3>Cambios contra el snapshot anterior (n.º {comp.anterior.id} · {comp.anterior.fecha_inventario ? fecha(comp.anterior.fecha_inventario) : comp.anterior.fecha_carga})</h3>
          <p className="rp-nota">Se compara por código de barras + lote (en maduración, caja + lote). Una línea repetida cuenta tantas veces como aparece.</p>
          <div className="grid-2">
            {[['Entraron', comp.altas, 'badge-green'], ['Salieron', comp.bajas, 'badge-red']].map(([titulo, lista, clase]) => (
              <div key={titulo}>
                <h4>{titulo} <span className={`badge ${clase}`}>{lista.reduce((s, x) => s + x.cantidad, 0)}</span></h4>
                <div className="table-container" style={{ maxHeight: 360, overflowY: 'auto' }}>
                  <table className="tabla-compacta">
                    <thead><tr><th>Hoja</th><th>Código</th><th>Descripción</th><th>Lote</th><th className="num">Cant.</th></tr></thead>
                    <tbody>
                      {lista.length === 0 && <tr><td colSpan={5} className="rp-tenue">Ninguna</td></tr>}
                      {lista.slice(0, 300).map(x => (
                        <tr key={x.clave}><td>{HOJA[x.hoja]}</td><td>{x.codigo || '—'}</td><td>{x.descripcion || '—'}</td><td>{x.lote || '—'}{x.caja ? ` · caja ${x.caja}` : ''}</td><td className="num">{x.cantidad}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {lista.length > 300 && <p className="rp-tenue">Se muestran 300 de {lista.length} grupos.</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

export default function InventarioPlanta() {
  const [recarga, setRecarga] = useState(0);
  return (
    <div>
      <div className="page-header">
        <h2>Inventario de la planta</h2>
      </div>
      <p className="rp-nota">Inventario semanal que manda CIISA (bodega 107 / paquetería). Cada carga es una foto: no cambia cajas, primales ni custodia de la app.</p>
      <CargarInventario onAplicado={(id) => setRecarga(id)} />
      <Snapshot recarga={recarga} />
    </div>
  );
}
