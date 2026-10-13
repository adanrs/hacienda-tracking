import { useMemo, useState } from 'react';
import { Plus, Trash2, Save, ClipboardPaste, X, CircleAlert } from 'lucide-react';
import { api } from '../../services/api';
import { aviso } from '../../components/ui/avisos';
import { confirmar } from '../../components/ui/confirmar';
import Boton from '../../components/ui/Boton';
import Campo from '../../components/ui/Campo';
import { fmtKg, numeroDe, parsearFilasPegadas } from './util';

const filaVacia = () => ({ articulo: '', descripcion: '', peso: '', unidad: 'KGS', cajas: '' });
const LIBRAS_POR_KG = 2.20462;

/*
  Captura y corrección de un reporte de CIISA (un lote CC).
  Sirve para la captura manual, para pegar filas y para revisar lo que trae un Excel antes
  de guardarlo. La validación definitiva la hace el backend (misma regla para todas las vías).
    inicial: { encabezado: { fechaProduccion, numLote, tipoProduccion, loteCC }, lineas: [...], aretesPorPosicion? }
*/
export default function EditorReporteCiisa({ inicial, idReporte = null, origenInicial = 'manual', archivoNombre = null, onGuardado, onCancelar }) {
  const enc0 = inicial?.encabezado || {};
  const [enc, setEnc] = useState({
    fechaProduccion: enc0.fechaProduccion || '',
    numLote: enc0.numLote || '',
    tipoProduccion: enc0.tipoProduccion || '',
    loteCC: enc0.loteCC || '',
  });
  const [lineas, setLineas] = useState(() => (inicial?.lineas?.length
    ? inicial.lineas.map(l => ({ articulo: String(l.articulo ?? ''), descripcion: l.descripcion || '', peso: String(l.peso ?? ''), unidad: l.unidad || 'KGS', cajas: String(l.cajas ?? '') }))
    : [filaVacia()]));
  const [pieKilos, setPieKilos] = useState('');
  const [pieCajas, setPieCajas] = useState('');
  const [pegado, setPegado] = useState('');
  const [mostrarPegar, setMostrarPegar] = useState(!inicial?.lineas?.length);
  const [origen, setOrigen] = useState(origenInicial);
  const [errores, setErrores] = useState([]);
  const [guardando, setGuardando] = useState(false);

  const totales = useMemo(() => {
    let kilos = 0;
    let cajas = 0;
    for (const l of lineas) {
      const p = numeroDe(l.peso);
      const c = numeroDe(l.cajas);
      if (!Number.isNaN(p)) kilos += p;
      if (!Number.isNaN(c)) cajas += c;
    }
    kilos = Math.round(kilos * 100) / 100;
    return { kilos, libras: Math.round(kilos * LIBRAS_POR_KG * 100) / 100, cajas };
  }, [lineas]);

  const cambiarFila = (i, campo, valor) => setLineas(ls => ls.map((l, j) => (j === i ? { ...l, [campo]: valor } : l)));
  const quitarFila = (i) => setLineas(ls => (ls.length > 1 ? ls.filter((_, j) => j !== i) : [filaVacia()]));

  const aplicarPegado = () => {
    const { lineas: nuevas, errores: errs } = parsearFilasPegadas(pegado);
    if (!nuevas.length) { aviso.error(errs[0] || 'No se reconoció ninguna fila. Cada fila debe empezar con el código del artículo.'); return; }
    // Las filas vacías del final se reemplazan; las ya digitadas se conservan.
    setLineas(ls => [...ls.filter(l => l.articulo || l.peso || l.cajas), ...nuevas]);
    setPegado('');
    setMostrarPegar(false);
    if (origen === 'manual') setOrigen('pegado');
    if (errs.length) aviso.info(`${nuevas.length} fila(s) agregadas. ${errs.length} línea(s) no se reconocieron: revíselas.`);
    else aviso.ok(`${nuevas.length} fila(s) agregadas`);
  };

  const guardar = async (reemplazar = false) => {
    setErrores([]);
    const usadas = lineas.filter(l => l.articulo || l.peso || l.cajas);
    const body = {
      encabezado: enc,
      lineas: usadas.map(l => ({
        articulo: l.articulo.trim(),
        descripcion: l.descripcion.trim() || null,
        peso: Number.isNaN(numeroDe(l.peso)) ? l.peso : numeroDe(l.peso),
        unidad: l.unidad,
        cajas: Number.isNaN(numeroDe(l.cajas)) ? l.cajas : numeroDe(l.cajas),
      })),
      origen,
      archivo_nombre: archivoNombre,
      reemplazar,
    };
    if (idReporte) body.id = idReporte;
    if (pieKilos !== '' || pieCajas !== '') body.pie = { kilos: pieKilos === '' ? null : pieKilos, cajas: pieCajas === '' ? null : numeroDe(pieCajas) };
    if (inicial?.aretesPorPosicion?.length) body.aretesPorPosicion = inicial.aretesPorPosicion;

    setGuardando(true);
    try {
      const r = await api.guardarReporteCiisa(body);
      aviso.ok(`Reporte del lote CC ${enc.loteCC} guardado: ${fmtKg(r.totales.kilos)} kg, ${r.totales.cajas} cajas`, { titulo: r.reemplazado ? 'Reporte reemplazado' : 'Reporte guardado' });
      if (r.aretes_sin_animal?.length) aviso.info(`Aretes sin animal en el registro: ${r.aretes_sin_animal.join(', ')}`);
      onGuardado?.(r);
    } catch (e) {
      if (e.status === 409 && e.datos?.existe && !reemplazar) {
        const ok = await confirmar({ titulo: 'Ya hay un reporte para ese lote', mensaje: `${e.message} ${idReporte ? 'El otro reporte se borra y este queda con esa fecha y lote.' : 'Las filas actuales se sustituyen por las de esta captura.'}`, textoConfirmar: 'Reemplazar', peligro: Boolean(idReporte) });
        if (ok) { setGuardando(false); await guardar(true); return; }
      } else {
        setErrores(e.datos?.detalles?.length ? e.datos.detalles : [e.message]);
      }
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <h3>{idReporte ? 'Corregir reporte de CIISA' : inicial?.lineas?.length ? 'Revisar reporte de CIISA' : 'Captura manual del reporte de CIISA'}</h3>
        {onCancelar && <button type="button" className="btn-icon" aria-label="Cerrar captura" onClick={onCancelar}><X size={18} aria-hidden="true" /></button>}
      </div>
      {archivoNombre && <p className="rp-tenue rp-nota">Datos leídos de «{archivoNombre}». Revíselos antes de guardar.</p>}

      <div className="rp-grid-4">
        <Campo etiqueta="Fecha de producción" requerido>
          <input type="date" value={enc.fechaProduccion} onChange={e => setEnc({ ...enc, fechaProduccion: e.target.value })} />
        </Campo>
        <Campo etiqueta="Lote CC" requerido ayuda="Posición del animal en el deshuese (06)">
          <input inputMode="numeric" maxLength={4} value={enc.loteCC} onChange={e => setEnc({ ...enc, loteCC: e.target.value.replace(/\D/g, '') })} />
        </Campo>
        <Campo etiqueta="Num. Lote">
          <input maxLength={20} value={enc.numLote} onChange={e => setEnc({ ...enc, numLote: e.target.value })} />
        </Campo>
        <Campo etiqueta="Tipo producción">
          <input maxLength={60} value={enc.tipoProduccion} onChange={e => setEnc({ ...enc, tipoProduccion: e.target.value.toUpperCase() })} placeholder="p. ej. TEMPISQUE" />
        </Campo>
      </div>

      {mostrarPegar ? (
        <div className="form-group">
          <label htmlFor="rp-pegar">Pegar filas del reporte de CIISA</label>
          <textarea
            id="rp-pegar"
            rows={6}
            value={pegado}
            onChange={e => setPegado(e.target.value)}
            placeholder={'11163\tBEEF TRIMMINGS\t97.40\tKGS\t4\n21231\tDELMONICO\t21.92\tKGS\t2'}
            aria-describedby="rp-pegar-ayuda"
          />
          <div id="rp-pegar-ayuda" className="campo-ayuda">
            Copie las filas desde Excel, el PDF o el correo (Artículo, Descripción, Peso, Unidad, Cajas). Los títulos y la fila de totales se ignoran.
          </div>
          <div className="rp-acciones" style={{ marginTop: 8 }}>
            <Boton icono={ClipboardPaste} onClick={aplicarPegado} disabled={!pegado.trim()}>Agregar filas pegadas</Boton>
            <Boton onClick={() => setMostrarPegar(false)}>Digitar a mano</Boton>
          </div>
        </div>
      ) : (
        <Boton tamano="sm" icono={ClipboardPaste} onClick={() => setMostrarPegar(true)}>Pegar filas</Boton>
      )}

      <div className="card rp-tabla-card" style={{ marginTop: 12 }}>
        <div className="table-container">
          <table className="rp-tabla-edicion">
            <thead>
              <tr><th>Artículo</th><th>Descripción</th><th className="num">Peso (kg)</th><th>Unidad</th><th className="num">Cajas</th><th><span className="sr-only">Quitar</span></th></tr>
            </thead>
            <tbody>
              {lineas.map((l, i) => (
                <tr key={i}>
                  <td><input aria-label={`Artículo, fila ${i + 1}`} inputMode="numeric" maxLength={5} value={l.articulo} onChange={e => cambiarFila(i, 'articulo', e.target.value.replace(/\D/g, ''))} /></td>
                  <td><input aria-label={`Descripción, fila ${i + 1}`} maxLength={200} value={l.descripcion} onChange={e => cambiarFila(i, 'descripcion', e.target.value)} placeholder="Del catálogo si se deja vacío" /></td>
                  <td><input aria-label={`Peso, fila ${i + 1}`} inputMode="decimal" value={l.peso} onChange={e => cambiarFila(i, 'peso', e.target.value)} className="num" /></td>
                  <td>
                    <select aria-label={`Unidad, fila ${i + 1}`} value={l.unidad} onChange={e => cambiarFila(i, 'unidad', e.target.value)}>
                      <option value="KGS">KGS</option>
                    </select>
                  </td>
                  <td><input aria-label={`Cajas, fila ${i + 1}`} inputMode="numeric" value={l.cajas} onChange={e => cambiarFila(i, 'cajas', e.target.value.replace(/\D/g, ''))} className="num" /></td>
                  <td><button type="button" className="btn-icon" aria-label={`Quitar fila ${i + 1}`} onClick={() => quitarFila(i)}><Trash2 size={16} aria-hidden="true" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <Boton tamano="sm" icono={Plus} onClick={() => setLineas(ls => [...ls, filaVacia()])}>Agregar fila</Boton>

      <div className="rp-pie" aria-live="polite">
        <div className="rp-pie-dato"><span>Filas</span>{lineas.filter(l => l.articulo).length}</div>
        <div className="rp-pie-dato"><span>Libras</span>{fmtKg(totales.libras)}</div>
        <div className="rp-pie-dato"><span>Kilos</span>{fmtKg(totales.kilos)}</div>
        <div className="rp-pie-dato"><span>Cajas</span>{totales.cajas}</div>
      </div>

      <div className="rp-grid-4" style={{ marginTop: 12 }}>
        <Campo etiqueta="Kilos del pie de CIISA" ayuda="Opcional: si lo digita, se verifica que cuadre con las filas.">
          <input inputMode="decimal" value={pieKilos} onChange={e => setPieKilos(e.target.value)} />
        </Campo>
        <Campo etiqueta="Cajas del pie de CIISA">
          <input inputMode="numeric" value={pieCajas} onChange={e => setPieCajas(e.target.value.replace(/\D/g, ''))} />
        </Campo>
      </div>

      {inicial?.aretesPorPosicion?.length > 0 && (
        <p className="rp-nota">Se guardarán también {inicial.aretesPorPosicion.length} aretes de la hoja «Aretes».</p>
      )}

      {errores.length > 0 && (
        <div className="banner error" role="alert">
          <CircleAlert size={18} aria-hidden="true" />
          <div>
            <strong>No se guardó. Corrija lo siguiente:</strong>
            <ul className="rp-lista-errores">{errores.slice(0, 15).map((e, i) => <li key={i}>{e}</li>)}</ul>
          </div>
        </div>
      )}

      <div className="modal-actions">
        {onCancelar && <Boton onClick={onCancelar}>Cancelar</Boton>}
        <Boton variante="primario" icono={Save} cargando={guardando} onClick={() => guardar(false)}>Guardar reporte</Boton>
      </div>
    </div>
  );
}
