import { useRef, useState } from 'react';
import { FileSpreadsheet, Download, Upload, PencilLine, Save, CircleAlert, CircleCheck } from 'lucide-react';
import { api } from '../../services/api';
import { aviso } from '../../components/ui/avisos';
import { confirmar } from '../../components/ui/confirmar';
import Boton from '../../components/ui/Boton';
import EditorReporteCiisa from './EditorReporteCiisa';
import { fmtKg, fechaCorta } from './util';

/*
  Carga del reporte que manda CIISA. Tres caminos al mismo guardado (POST /ciisa):
    1. Importar un Excel/CSV con la plantilla → vista previa por lote → guardar o revisar.
    2. Captura manual (o pegando filas) en el editor.
    3. Corregir un reporte ya cargado (llega desde la pestaña Reporte con `edicion`).
  El importador no guarda nada por sí solo: el usuario ve totales y errores antes.
*/
export default function CargaCiisa({ fecha, edicion, setEdicion, onGuardado }) {
  const refArchivo = useRef(null);
  const [importando, setImportando] = useState(false);
  const [vista, setVista] = useState(null); // { archivo_nombre, reportes, errores }
  const [guardandoTodos, setGuardandoTodos] = useState(false);

  const importar = async (e) => {
    const archivo = e.target.files?.[0];
    e.target.value = '';
    if (!archivo) return;
    if (archivo.size > 2 * 1024 * 1024) { aviso.error('El archivo pesa más de 2 MB'); return; }
    setImportando(true);
    setVista(null);
    try {
      setVista(await api.importarReporteCiisa(archivo));
    } catch (err) {
      aviso.error(err.message, { titulo: 'No se pudo leer el archivo' });
    } finally {
      setImportando(false);
    }
  };

  const guardarUno = async (r, reemplazar = false) => {
    try {
      const res = await api.guardarReporteCiisa({ ...r, origen: 'excel_csv', archivo_nombre: vista.archivo_nombre, reemplazar });
      return { ok: true, res };
    } catch (err) {
      if (err.status === 409 && err.datos?.existe && !reemplazar) {
        const ok = await confirmar({ titulo: `Lote CC ${r.encabezado.loteCC} ya cargado`, mensaje: err.message, textoConfirmar: 'Reemplazar' });
        if (ok) return guardarUno(r, true);
        return { ok: false, omitido: true };
      }
      return { ok: false, error: err.datos?.detalles?.[0] || err.message };
    }
  };

  const guardarTodos = async () => {
    setGuardandoTodos(true);
    let guardados = 0;
    const fallas = [];
    const restantes = [];
    for (const r of vista.reportes.filter(x => !x.errores)) {
      const res = await guardarUno(r);
      if (res.ok) guardados++;
      else { restantes.push(r); if (res.error) fallas.push(`Lote CC ${r.encabezado.loteCC}: ${res.error}`); }
    }
    setGuardandoTodos(false);
    if (guardados) aviso.ok(`${guardados} reporte(s) guardado(s)`);
    if (fallas.length) aviso.error(fallas.join(' · '), { titulo: 'Algunos lotes no se guardaron' });
    const quedan = [...vista.reportes.filter(x => x.errores), ...restantes];
    setVista(quedan.length ? { ...vista, reportes: quedan } : null);
    // Solo se pasa al reporte si no quedó nada pendiente de corregir en la vista previa.
    if (guardados) onGuardado?.(vista.reportes[0]?.encabezado?.fechaProduccion, quedan.length === 0);
  };

  if (edicion) {
    return (
      <EditorReporteCiisa
        key={edicion.clave}
        inicial={edicion.datos}
        idReporte={edicion.id || null}
        origenInicial={edicion.origen}
        archivoNombre={edicion.archivo_nombre}
        onCancelar={() => setEdicion(null)}
        onGuardado={(r) => {
          setEdicion(null);
          if (edicion.desdeVista) setVista(v => (v ? { ...v, reportes: v.reportes.filter(x => x !== edicion.datos) } : v));
          onGuardado?.(r.fecha);
        }}
      />
    );
  }

  const validos = vista?.reportes.filter(r => !r.errores) || [];

  return (
    <div>
      <div className="grid-2">
        <div className="card">
          <h3 className="rp-subtitulo"><FileSpreadsheet size={20} aria-hidden="true" /> Importar Excel o CSV</h3>
          <p className="rp-nota">
            Use la plantilla (columnas Fecha, Num. Lote, Tipo producción, Lote CC, Artículo, Descripción, Peso, Unidad, Cajas y una hoja «Aretes» opcional).
            Puede traer varios lotes CC: la app los separa y le muestra los totales antes de guardar.
          </p>
          <div className="rp-acciones">
            <Boton icono={Download} onClick={() => api.descargarPlantillaReporte().catch(e => aviso.error(e.message))}>Descargar plantilla</Boton>
            <Boton variante="primario" icono={Upload} cargando={importando} onClick={() => refArchivo.current?.click()}>Elegir archivo…</Boton>
            <input ref={refArchivo} type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={importar} hidden />
          </div>
        </div>
        <div className="card">
          <h3 className="rp-subtitulo"><PencilLine size={20} aria-hidden="true" /> Captura manual</h3>
          <p className="rp-nota">
            Si CIISA lo mandó como foto o PDF: digite el encabezado y pegue o digite las filas. Si anota los totales del pie, la app verifica que cuadren.
          </p>
          <Boton variante="primario" icono={PencilLine} onClick={() => setEdicion({ clave: Date.now(), datos: { encabezado: { fechaProduccion: fecha }, lineas: [] }, origen: 'manual' })}>
            Capturar reporte
          </Boton>
        </div>
      </div>

      {vista && (
        <div className="card">
          <div className="card-header">
            <h3>Vista previa de «{vista.archivo_nombre}»</h3>
            {validos.length > 1 && <Boton variante="primario" icono={Save} cargando={guardandoTodos} onClick={guardarTodos}>Guardar los {validos.length} lotes</Boton>}
          </div>
          {vista.errores.length > 0 && (
            <div className="banner error" role="alert">
              <CircleAlert size={18} aria-hidden="true" />
              <div>
                <strong>El archivo tiene problemas:</strong>
                <ul className="rp-lista-errores">{vista.errores.slice(0, 20).map((e, i) => <li key={i}>{e}</li>)}</ul>
                {vista.errores.length > 20 && <div>…y {vista.errores.length - 20} más.</div>}
              </div>
            </div>
          )}
          {vista.reportes.length > 0 && (
            <div className="card rp-tabla-card">
              <div className="table-container">
                <table>
                  <thead>
                    <tr><th>Fecha</th><th>Lote CC</th><th>Num. Lote</th><th className="num">Filas</th><th className="num">Kilos</th><th className="num">Libras</th><th className="num">Cajas</th><th>Estado</th><th><span className="sr-only">Acciones</span></th></tr>
                  </thead>
                  <tbody>
                    {vista.reportes.map((r, i) => (
                      <tr key={i} className={r.errores ? 'rp-fila-dif' : ''}>
                        <td>{fechaCorta(r.encabezado.fechaProduccion)}</td>
                        <td><strong>{r.encabezado.loteCC}</strong></td>
                        <td>{r.encabezado.numLote || '—'}</td>
                        <td className="num">{r.lineas.length}</td>
                        <td className="num">{r.totales ? fmtKg(r.totales.kilos) : '—'}</td>
                        <td className="num">{r.totales ? fmtKg(r.totales.libras) : '—'}</td>
                        <td className="num">{r.totales ? r.totales.cajas : '—'}</td>
                        <td>
                          {r.errores
                            ? <span className="badge badge-red"><CircleAlert size={13} aria-hidden="true" /> {r.errores.length} error(es)</span>
                            : <span className="badge badge-green"><CircleCheck size={13} aria-hidden="true" /> Listo</span>}
                        </td>
                        <td>
                          <div className="rp-acciones">
                            <Boton tamano="sm" icono={PencilLine} onClick={() => setEdicion({ clave: Date.now(), datos: r, origen: 'excel_csv', archivo_nombre: vista.archivo_nombre, desdeVista: true })}>
                              {r.errores ? 'Corregir' : 'Revisar'}
                            </Boton>
                            {!r.errores && (
                              <Boton tamano="sm" variante="primario" icono={Save} onClick={async () => {
                                const res = await guardarUno(r);
                                if (res.ok) {
                                  aviso.ok(`Lote CC ${r.encabezado.loteCC} guardado: ${fmtKg(res.res.totales.kilos)} kg, ${res.res.totales.cajas} cajas`);
                                  setVista(v => {
                                    const resto = v.reportes.filter(x => x !== r);
                                    return resto.length ? { ...v, reportes: resto } : null;
                                  });
                                  onGuardado?.(r.encabezado.fechaProduccion, false);
                                } else if (res.error) aviso.error(res.error);
                              }}>Guardar</Boton>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
