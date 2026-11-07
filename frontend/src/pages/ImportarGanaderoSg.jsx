import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Upload, CheckCircle2, Truck, ArrowLeft, CircleAlert, FileSpreadsheet, ListChecks } from 'lucide-react';
import Boton from '../components/ui/Boton';
import { confirmar } from '../components/ui/confirmar';
import { aviso } from '../components/ui/avisos';
import { useAuth } from '../components/AuthContext';
import VistaPrevia from '../components/importador/VistaPrevia';
import ResumenPlan from '../components/importador/ResumenPlan';
import useImportacion from '../components/importador/useImportacion';
import LecturaFoto from '../components/importador/LecturaFoto';

/*
  Importar desde Ganadero SG: el reporte personalizado «Sistematización de Hatos» (salida de
  animales de la finca). Subir → vista previa (nada se guarda) → Aplicar con confirmación.
  Si las filas traen Fec. salida y Vendido a, se arma la guía de transporte del día.
  También por FOTO del reporte impreso (celular) o pegando la tabla: el texto queda en un cuadro
  editable y pasa por el mismo procesador; las filas dudosas (p. ej. una I.E. con un dígito de
  menos) salen marcadas «Leído por foto: revisar».
*/
const fechaCorta = (iso) => (iso ? iso.split('-').reverse().join('/') : '—');
const kg = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 1 }));
const MAX_MB = 5;

const COLUMNAS = [
  { titulo: 'Número', valor: f => <strong>{f.numero || '—'}</strong> },
  { titulo: 'I.E.', valor: f => <code style={{ fontSize: '0.8em' }}>{f.ie || '—'}</code> },
  { titulo: 'Sexo', valor: f => (f.datos?.sexo === 'macho' ? 'M' : f.datos?.sexo === 'hembra' ? 'H' : '—') },
  { titulo: 'Raza', valor: f => f.datos?.raza || '—' },
  { titulo: 'Potrero', valor: f => (f.datos?.potrero_nombre ? `${f.datos.potrero_nombre}${f.datos.potrero_nuevo ? ' (nuevo)' : ''}` : '—') },
  { titulo: 'Peso (kg)', num: true, valor: f => kg(f.datos?.peso_actual) },
  { titulo: 'Salida', valor: f => (f.salida ? fechaCorta(f.salida.fecha_salida) : '—') },
];

export default function ImportarGanaderoSg() {
  const { canEdit } = useAuth();
  const refArchivo = useRef(null);
  const [archivo, setArchivo] = useState(null);
  const [crearGuias, setCrearGuias] = useState(true);
  const [texto, setTexto] = useState('');
  const [foto, setFoto] = useState(null); // { dudosas } si el texto salió de una foto
  const imp = useImportacion('ganadero-sg');
  const { plan } = imp;

  const elegir = async (e) => {
    const a = e.target.files?.[0];
    e.target.value = '';
    if (!a) return;
    if (a.size > MAX_MB * 1024 * 1024) { aviso.error(`El archivo pesa más de ${MAX_MB} MB`); return; }
    setArchivo(a); setFoto(null);
    await imp.planificar({ archivo: a }, { crear_guias: crearGuias });
  };
  const leerTexto = () => {
    if (!texto.trim()) { aviso.error('Pegue la tabla o cargue la foto del reporte primero'); return; }
    setArchivo(null);
    imp.planificar({ pegado: { texto } }, { crear_guias: crearGuias, foto: foto || undefined });
  };

  const cambiarGuias = (v) => {
    setCrearGuias(v);
    if (plan) imp.replanificar({ crear_guias: v });
  };

  const aplicar = async () => {
    const r = plan.resumen;
    const partes = [`${r.nuevos} animal(es) nuevo(s)`, `${r.actualizados} actualizado(s)`];
    if (plan.guias?.length) partes.push(`${plan.guias.length} guía(s) de transporte`);
    const ok = await confirmar({
      titulo: '¿Aplicar la importación?',
      mensaje: `Se guardarán ${partes.join(', ')}.${r.errores ? ` Las ${r.errores} fila(s) con error NO se importan.` : ''} Todo se guarda junto: si algo falla, no se guarda nada.`,
      textoConfirmar: 'Aplicar',
    });
    if (!ok) return;
    const res = await imp.aplicar();
    if (res) aviso.ok('Importación aplicada');
  };

  const aplicables = plan ? plan.filas.filter(f => f.accion !== 'error' && f.accion !== 'sin_cambios').length + (plan.guias || []).filter(g => g.accion !== 'sin_cambios').length : 0;

  return (
    <div>
      <div className="page-header">
        <h2>Importar desde Ganadero SG</h2>
        <Link to="/animales" className="btn btn-secondary"><ArrowLeft size={16} aria-hidden="true" /> Volver a Animales</Link>
      </div>

      {!canEdit && <div className="banner info" role="status">Su usuario es de solo lectura: puede ver esta pantalla pero no importar.</div>}

      <div className="card">
        <h3 className="rp-subtitulo"><FileSpreadsheet size={20} aria-hidden="true" /> Reporte de Software GANADERO SG</h3>
        <p className="rp-nota">
          Exporte el reporte personalizado (Número, Sexo, F. Nto, Raza, # Madre, # Padre, Pot., I.E., U.Peso, FUV, UV, Fec. salida, Peso sal., Vendido a…)
          y súbalo tal cual, con los títulos de arriba: la app encuentra sola la fila de encabezados. Acepta .xlsx, .csv y .xls exportado como texto.
          Si solo tiene el reporte impreso, cárguelo por foto (una por página). Nada se guarda hasta que usted revise la vista previa y presione «Aplicar».
        </p>
        <div className="rp-acciones">
          <Boton variante="primario" icono={Upload} cargando={imp.cargando} disabled={!canEdit} onClick={() => refArchivo.current?.click()}>
            {archivo ? 'Elegir otro archivo…' : 'Elegir archivo…'}
          </Boton>
          <input ref={refArchivo} type="file" accept=".xlsx,.xls,.csv,.txt" onChange={elegir} hidden />
          {archivo && <span className="rp-tenue">{archivo.name}</span>}
        </div>
        <div className="form-group" style={{ marginTop: 'var(--esp-4)' }}>
          <label htmlFor="sg-texto">O cargue el reporte impreso por foto (o pegue la tabla) y revise el texto</label>
          <LecturaFoto formato="ganadero-sg" deshabilitado={!canEdit}
            onTexto={(t, dudas) => { setTexto(t); setFoto({ dudosas: dudas }); }} />
          <textarea id="sg-texto" rows={5} className="imp-pegado" value={texto} disabled={!canEdit} style={{ marginTop: 'var(--esp-2)' }}
            placeholder={'01-003 - ENGORDE WAGYU\nActualizado a: 15/10/26\nNúmero\tSexo\tF. Nto\tRaza\t…\tFec. salida\tPeso sal.\tVendido a'}
            onChange={e => { setTexto(e.target.value); if (!e.target.value.trim()) setFoto(null); }} />
          <Boton icono={ListChecks} cargando={imp.cargando} disabled={!canEdit || !texto.trim()} onClick={leerTexto}>Ver vista previa del texto</Boton>
        </div>
        <div className="rp-acciones">
          <label className="rp-check">
            <input type="checkbox" checked={crearGuias} onChange={e => cambiarGuias(e.target.checked)} />
            Crear o actualizar la guía de transporte con los animales que traen fecha de salida
          </label>
        </div>
      </div>

      {imp.resultado && (
        <div className="banner ok" role="status">
          <CheckCircle2 size={18} aria-hidden="true" />
          <div>
            <strong>Importación aplicada.</strong>{' '}
            {imp.resultado.resultado.resumen.animales_nuevos} animal(es) nuevo(s), {imp.resultado.resultado.resumen.animales_actualizados} actualizado(s),
            {' '}{imp.resultado.resultado.resumen.pesajes} pesaje(s), {imp.resultado.resultado.resumen.vacunas} vacuna(s).
            {imp.resultado.resultado.guias?.map(g => (
              <div key={g.id}><Link to={`/guias-transporte/${g.id}`}><Truck size={14} aria-hidden="true" /> Ver la guía {g.numero}</Link></div>
            ))}
          </div>
        </div>
      )}

      {plan && (
        <div className="card">
          <div className="card-header">
            <h3>Vista previa{plan.archivo_nombre ? ` de «${plan.archivo_nombre}»` : ''}</h3>
            <Boton variante="primario" icono={CheckCircle2} cargando={imp.aplicando} disabled={!canEdit || aplicables === 0} onClick={aplicar}>
              Aplicar
            </Boton>
          </div>
          <p className="rp-nota">
            {plan.metadatos?.finca && <>Finca <strong>{plan.metadatos.finca}</strong> · </>}
            {plan.metadatos?.actualizado_a && <>Actualizado a {fechaCorta(plan.metadatos.actualizado_a)} · </>}
            Encabezados en la fila {plan.encabezado?.fila}
            {plan.potreros_nuevos?.length > 0 && <> · Potreros nuevos: {plan.potreros_nuevos.join(', ')}</>}
          </p>
          <ResumenPlan resumen={plan.resumen} />
          {aplicables === 0 && (
            <div className="banner info" role="status">No hay nada nuevo que guardar: este archivo ya está importado{plan.resumen.errores ? ' (las filas con error no se importan)' : ''}.</div>
          )}

          {plan.guias?.length > 0 && (
            <div className="imp-guias">
              <h4><Truck size={18} aria-hidden="true" /> Guía(s) de transporte / salida a planta</h4>
              {plan.guias.map(g => (
                <div key={g.clave} className="imp-guia">
                  <div>
                    <strong>{g.numero || 'Guía nueva'}</strong> · salida {fechaCorta(g.fecha_salida)} · {g.finca_origen || 'sin finca'} → {g.destino || 'planta'}
                    {g.comprador && <> · vendido a <strong>{g.comprador}</strong></>}
                  </div>
                  <div>{g.total_animales} animales · {kg(g.peso_total_kg)} kg · <span className={`badge ${g.accion === 'nuevo' ? 'badge-green' : g.accion === 'actualizar' ? 'badge-blue' : 'badge-gray'}`}>{g.accion === 'nuevo' ? 'Se crea' : g.accion === 'actualizar' ? 'Se actualiza' : 'Sin cambios'}</span></div>
                  <div className="rp-tenue">{g.animales.map(a => a.arete).join(', ')}</div>
                  {g.avisos.map((a, i) => <div key={i} style={{ color: 'var(--alerta)' }}><CircleAlert size={14} aria-hidden="true" /> {a}</div>)}
                </div>
              ))}
            </div>
          )}

          <VistaPrevia key={plan.huella} filas={plan.filas} columnas={COLUMNAS} />
        </div>
      )}
    </div>
  );
}
