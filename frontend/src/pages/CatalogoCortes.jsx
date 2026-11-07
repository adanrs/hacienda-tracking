import { Fragment, useEffect, useMemo, useState } from 'react';
import { Plus, Edit, Ban, RotateCcw, History, Upload, ListChecks, CheckCircle2 } from 'lucide-react';
import { api } from '../services/api';
import { confirmar } from '../components/ui/confirmar';
import { aviso } from '../components/ui/avisos';
import { useAuth } from '../components/AuthContext';
import { FilaEstado } from '../components/ui/Estados';
import Boton from '../components/ui/Boton';
import VistaPrevia from '../components/importador/VistaPrevia';
import ResumenPlan from '../components/importador/ResumenPlan';
import useImportacion from '../components/importador/useImportacion';
import LecturaFoto from '../components/importador/LecturaFoto';
import { TIPOS_CORTE, UNIDADES } from '../components/AltaRapidaCorte';

/*
  Catálogo de cortes en la base (fase 2). Tres pestañas:
    - Catálogo: crear, editar y desactivar (nunca borrar: lo histórico lo sigue usando), con bitácora.
    - Pendientes de codificar: líneas que quedaron en el código genérico 99 (reporte de producción o
      solicitudes históricas); se reasignan al código real de una vez, con bitácora.
    - Importar listado: el listado completo de la planta (Excel o pegado) con el motor de vista
      previa: nuevos / cambian / sin cambios. No desactiva lo que no venga.
*/
const NOMBRE_TIPO = Object.fromEntries(TIPOS_CORTE);
const tipoBadge = { primal: 'badge-blue', subprimal: 'badge-blue', hueso: 'badge-gray', subproducto: 'badge-yellow', trimming: 'badge-orange', retail: 'badge-green' };
const fecha = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—');
const ACCION = { creado: 'Creado', editado: 'Editado', desactivado: 'Desactivado', activado: 'Activado', reasignado: 'Reasignado desde 99' };

function Catalogo({ canEdit }) {
  const [cortes, setCortes] = useState(null);
  const [error, setError] = useState(null);
  const [filtro, setFiltro] = useState({ q: '', tipo: '', activo: '1' });
  const [form, setForm] = useState(null);
  const [bitacora, setBitacora] = useState(null);

  const cargar = () => { setError(null); api.getCatalogoCortes().then(setCortes).catch(e => setError(e.message)); };
  useEffect(cargar, []);

  const visibles = useMemo(() => (cortes || []).filter(c => {
    if (filtro.activo !== '' && String(Number(c.activo)) !== filtro.activo) return false;
    if (filtro.tipo && c.tipo !== filtro.tipo) return false;
    const q = filtro.q.trim().toLowerCase();
    return !q || c.codigo.includes(q) || String(c.nombre).toLowerCase().includes(q);
  }), [cortes, filtro]);

  const guardar = async (e) => {
    e.preventDefault();
    try {
      if (form.id) await api.updateCatalogoCorte(form.id, { codigo: form.codigo, nombre: form.nombre, tipo: form.tipo, unidad: form.unidad, activo: form.activo ? 1 : 0, notas: form.notas || null, namp: form.namp || null });
      else await api.createCatalogoCorte({ ...form, activo: form.activo ? 1 : 0 });
      aviso.ok(form.id ? 'Corte actualizado' : 'Corte agregado');
      setForm(null); cargar();
    } catch (err) { aviso.error(err.message); }
  };
  const cambiarActivo = async (c) => {
    if (Number(c.activo)) {
      if (!(await confirmar({ titulo: `¿Desactivar ${c.codigo}?`, mensaje: 'No se ofrecerá en solicitudes ni reportes nuevos. Lo histórico lo sigue mostrando.', textoConfirmar: 'Desactivar', peligro: true }))) return;
      try { await api.deleteCatalogoCorte(c.id); cargar(); } catch (err) { aviso.error(err.message); }
    } else {
      try { await api.updateCatalogoCorte(c.id, { activo: 1 }); cargar(); } catch (err) { aviso.error(err.message); }
    }
  };
  const verBitacora = async (c) => {
    try { setBitacora({ corte: c, filas: await api.getBitacoraCorte(c.id) }); } catch (err) { aviso.error(err.message); }
  };

  return (
    <div className="card">
      <div className="sel-filtros" style={{ marginBottom: 12 }}>
        <div className="form-group"><label htmlFor="cc-q">Buscar</label><input id="cc-q" value={filtro.q} onChange={e => setFiltro({ ...filtro, q: e.target.value })} placeholder="código o descripción" /></div>
        <div className="form-group"><label htmlFor="cc-tipo">Tipo</label>
          <select id="cc-tipo" value={filtro.tipo} onChange={e => setFiltro({ ...filtro, tipo: e.target.value })}><option value="">Todos</option>{TIPOS_CORTE.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></div>
        <div className="form-group"><label htmlFor="cc-act">Estado</label>
          <select id="cc-act" value={filtro.activo} onChange={e => setFiltro({ ...filtro, activo: e.target.value })}><option value="1">Activos</option><option value="0">Inactivos</option><option value="">Todos</option></select></div>
        {canEdit && <Boton variante="primario" icono={Plus} onClick={() => setForm({ codigo: '', nombre: '', tipo: 'primal', unidad: 'kg', activo: true })}>Nuevo corte</Boton>}
      </div>
      <div className="table-container">
        <table>
          <thead><tr><th>Código</th><th>Descripción</th><th>Tipo</th><th>Unidad</th><th>Serie</th><th>Estado</th><th>Acciones</th></tr></thead>
          <tbody>
            <FilaEstado columnas={7} cargando={!cortes && !error} error={error} vacio={cortes && !visibles.length} onReintentar={cargar} tituloVacio="Sin cortes con ese filtro" />
            {visibles.map(c => (
              <tr key={c.id}>
                <td><strong>{c.codigo}</strong></td>
                <td>{c.nombre}</td>
                <td><span className={`badge ${tipoBadge[c.tipo] || 'badge-gray'}`}>{NOMBRE_TIPO[c.tipo] || c.tipo}</span></td>
                <td>{c.unidad || 'kg'}</td>
                <td>{c.serie || '—'}</td>
                <td><span className={`badge ${Number(c.activo) ? 'badge-green' : 'badge-gray'}`}>{Number(c.activo) ? 'Activo' : 'Inactivo'}</span></td>
                <td>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button type="button" className="btn-icon" aria-label={`Bitácora de ${c.codigo}`} onClick={() => verBitacora(c)}><History size={16} aria-hidden="true" /></button>
                    {canEdit && c.codigo !== '99' && <>
                      <button type="button" className="btn-icon" aria-label={`Editar ${c.codigo}`} onClick={() => setForm({ ...c, activo: Boolean(Number(c.activo)) })}><Edit size={16} aria-hidden="true" /></button>
                      <button type="button" className="btn-icon" aria-label={`${Number(c.activo) ? 'Desactivar' : 'Activar'} ${c.codigo}`} onClick={() => cambiarActivo(c)}>
                        {Number(c.activo) ? <Ban size={16} color="#8f1d17" aria-hidden="true" /> : <RotateCcw size={16} aria-hidden="true" />}
                      </button>
                    </>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {form && (
        <div className="modal-overlay" onClick={() => setForm(null)}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="cc-form-titulo" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h3 id="cc-form-titulo">{form.id ? `Editar ${form.codigo}` : 'Nuevo corte'}</h3>
              <button type="button" className="btn-icon" aria-label="Cerrar" onClick={() => setForm(null)}>&times;</button></div>
            <form onSubmit={guardar}>
              <div className="form-row">
                <div className="form-group"><label htmlFor="cc-codigo">Código (5 dígitos) *</label>
                  <input id="cc-codigo" required inputMode="numeric" pattern="\d{5}" maxLength={5} value={form.codigo} onChange={e => setForm({ ...form, codigo: e.target.value.replace(/\D/g, '') })} /></div>
                <div className="form-group"><label htmlFor="cc-nombre">Descripción *</label>
                  <input id="cc-nombre" required maxLength={200} value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} /></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label htmlFor="cc-tipo2">Tipo</label>
                  <select id="cc-tipo2" value={form.tipo} onChange={e => setForm({ ...form, tipo: e.target.value })}>{TIPOS_CORTE.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></div>
                <div className="form-group"><label htmlFor="cc-unidad">Unidad</label>
                  <select id="cc-unidad" value={form.unidad || 'kg'} onChange={e => setForm({ ...form, unidad: e.target.value })}>{UNIDADES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></div>
              </div>
              <div className="form-group"><label htmlFor="cc-namp">Código NAMP</label>
                <input id="cc-namp" maxLength={20} value={form.namp || ''} onChange={e => setForm({ ...form, namp: e.target.value })} /></div>
              <div className="form-group"><label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={Boolean(form.activo)} onChange={e => setForm({ ...form, activo: e.target.checked })} /> Activo (se ofrece en lo nuevo)</label></div>
              <div className="form-group"><label htmlFor="cc-notas">Notas</label><textarea id="cc-notas" rows={2} value={form.notas || ''} onChange={e => setForm({ ...form, notas: e.target.value })} /></div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setForm(null)}>Cancelar</button>
                <button type="submit" className="btn btn-primary">{form.id ? 'Guardar' : 'Agregar'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {bitacora && (
        <div className="modal-overlay" onClick={() => setBitacora(null)}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="cc-bit-titulo" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h3 id="cc-bit-titulo">Bitácora de {bitacora.corte.codigo}</h3>
              <button type="button" className="btn-icon" aria-label="Cerrar" onClick={() => setBitacora(null)}>&times;</button></div>
            {!bitacora.filas.length ? <p className="rp-tenue">Sin cambios registrados (viene de la semilla del catálogo).</p> : (
              <table className="tabla-compacta">
                <thead><tr><th>Fecha</th><th>Quién</th><th>Qué</th><th>Detalle</th></tr></thead>
                <tbody>{bitacora.filas.map(b => {
                  const d = typeof b.detalle === 'string' ? JSON.parse(b.detalle) : b.detalle;
                  return (
                    <tr key={b.id}><td>{fecha(b.created_at)}</td><td>{b.usuario || '—'}</td><td>{ACCION[b.accion] || b.accion}{b.origen !== 'pantalla' ? ` (${b.origen.replace('_', ' ')})` : ''}</td>
                      <td>{d?.cambios ? d.cambios.map(c => `${c.campo}: ${c.antes ?? '—'} → ${c.despues ?? '—'}`).join('; ') : d?.lineas != null ? `${d.lineas} línea(s) de «${d.informado}»` : ''}</td></tr>
                  );
                })}</tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Pendientes({ canEdit }) {
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState(null);
  const [codigos, setCodigos] = useState({});
  const cargar = () => { setError(null); api.getPendientesCodificar().then(setFilas).catch(e => setError(e.message)); };
  useEffect(cargar, []);
  const reasignar = async (f) => {
    const codigo = (codigos[`${f.origen}|${f.informado}`] || '').trim();
    if (!/^\d{5}$/.test(codigo)) { aviso.error('Escriba el código real de 5 dígitos'); return; }
    if (!(await confirmar({ titulo: `¿Pasar a ${codigo}?`, mensaje: `${f.lineas} línea(s) con «${f.informado || f.descripcion}» dejan el 99 y quedan con el código ${codigo}.`, textoConfirmar: 'Reasignar' }))) return;
    try {
      const r = await api.reasignarPendiente({ origen: f.origen, informado: f.informado, codigo });
      aviso.ok(`${r.lineas} línea(s) ahora son ${r.codigo} ${r.nombre}`); cargar();
    } catch (e) { aviso.error(e.message); }
  };
  return (
    <div className="card">
      <p className="rp-tenue">Lo que la planta trajo sin un código del catálogo quedó con el genérico <strong>99 «Corte pendiente de codificar»</strong>. Escriba el código real (créelo antes en «Catálogo» si no existe).</p>
      <div className="table-container">
        <table>
          <thead><tr><th>Viene de</th><th>Lo que traía la planta</th><th className="num">Líneas</th><th className="num">Kilos</th><th>Fechas</th><th>Código real</th></tr></thead>
          <tbody>
            <FilaEstado columnas={6} cargando={!filas && !error} error={error} vacio={filas && !filas.length} onReintentar={cargar} tituloVacio="No hay nada pendiente de codificar" />
            {(filas || []).map(f => {
              const k = `${f.origen}|${f.informado}`;
              return (
                <tr key={k}>
                  <td>{f.origen === 'reporte' ? 'Reporte de producción' : 'Solicitud de deshuese'}</td>
                  <td><strong>{f.informado}</strong>{f.descripcion && f.descripcion !== f.informado ? ` · ${f.descripcion}` : ''}</td>
                  <td className="num">{f.lineas}</td>
                  <td className="num">{f.kg == null ? '—' : f.kg.toFixed(2)}</td>
                  <td>{fecha(f.desde)}{f.hasta !== f.desde ? ` – ${fecha(f.hasta)}` : ''}</td>
                  <td>{canEdit ? (
                    <span className="imp-correccion">
                      <input aria-label={`Código real para ${f.informado}`} className="imp-input-arete" inputMode="numeric" maxLength={5}
                        value={codigos[k] || ''} onChange={e => setCodigos(c => ({ ...c, [k]: e.target.value.replace(/\D/g, '') }))} />
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => reasignar(f)}>Reasignar</button>
                    </span>) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ImportarListado({ canEdit }) {
  const [texto, setTexto] = useState('');
  const [foto, setFoto] = useState(null); // { dudosas } si el listado salió de una foto
  const imp = useImportacion('catalogo-cortes');
  const { plan } = imp;
  const elegir = (e) => { const a = e.target.files?.[0]; e.target.value = ''; if (a) { setFoto(null); imp.planificar({ archivo: a }); } };
  const aplicar = async () => {
    if (!(await confirmar({ titulo: '¿Aplicar el listado?', mensaje: `${plan.resumen.nuevos} nuevo(s) y ${plan.resumen.actualizados} con cambios. Lo que no venga en el listado NO se desactiva.`, textoConfirmar: 'Aplicar' }))) return;
    const r = await imp.aplicar();
    if (r) aviso.ok('Catálogo actualizado');
  };
  const COLUMNAS = [
    { titulo: 'Código', valor: f => <strong>{f.clave}</strong> },
    { titulo: 'Descripción', valor: f => f.datos?.nombre || '—' },
    { titulo: 'Tipo', valor: f => NOMBRE_TIPO[f.datos?.tipo] || f.datos?.tipo || '—' },
  ];
  return (
    <div className="card">
      <p className="rp-tenue">Columnas: <strong>Código</strong> y <strong>Descripción</strong> (obligatorias); <strong>Tipo</strong>, <strong>Unidad</strong> y <strong>Activo</strong> si las trae. Excel, CSV o pegado desde Excel.</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <label className="btn btn-secondary" style={{ cursor: canEdit ? 'pointer' : 'not-allowed' }}>
          <Upload size={16} aria-hidden="true" /> Subir Excel o CSV
          <input type="file" accept=".xlsx,.csv,.txt,.docx" hidden disabled={!canEdit} onChange={elegir} />
        </label>
        <LecturaFoto formato="catalogo-cortes" deshabilitado={!canEdit} onTexto={(t, dudas) => { setTexto(t); setFoto({ dudosas: dudas }); }} />
      </div>
      <div className="form-group"><label htmlFor="cc-pegar">O pegue el listado</label>
        <textarea id="cc-pegar" rows={6} value={texto} onChange={e => { setTexto(e.target.value); if (!e.target.value.trim()) setFoto(null); }} placeholder={'Codigo\tDescripcion\tTipo\n22229\tCH-CHUCK RES\ttrimming'} /></div>
      <Boton icono={ListChecks} cargando={imp.cargando} disabled={!canEdit || !texto.trim()} onClick={() => imp.planificar({ pegado: { texto } }, { foto: foto || undefined })}>Ver vista previa</Boton>
      {plan && (
        <Fragment>
          <ResumenPlan resumen={plan.resumen} />
          <VistaPrevia filas={plan.filas} columnas={COLUMNAS} />
          <div className="modal-actions">
            <Boton variante="primario" icono={CheckCircle2} cargando={imp.aplicando} disabled={!canEdit || !(plan.resumen.nuevos + plan.resumen.actualizados)} onClick={aplicar}>Aplicar listado</Boton>
          </div>
        </Fragment>
      )}
    </div>
  );
}

const PESTANAS = [['catalogo', 'Catálogo'], ['pendientes', 'Pendientes de codificar'], ['importar', 'Importar listado']];

export default function CatalogoCortes() {
  const { canEdit } = useAuth();
  const [tab, setTab] = useState('catalogo');
  return (
    <div>
      <div className="page-header"><h2>Catálogo de cortes</h2></div>
      <div className="tabs" role="tablist" aria-label="Catálogo de cortes">
        {PESTANAS.filter(([id]) => canEdit || id !== 'importar').map(([id, t]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={`tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>{t}</button>
        ))}
      </div>
      {tab === 'catalogo' && <Catalogo canEdit={canEdit} />}
      {tab === 'pendientes' && <Pendientes canEdit={canEdit} />}
      {tab === 'importar' && canEdit && <ImportarListado canEdit={canEdit} />}
    </div>
  );
}
