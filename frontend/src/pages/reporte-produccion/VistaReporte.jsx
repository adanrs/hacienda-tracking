import { useEffect, useState, useCallback } from 'react';
import { Download, CircleCheck, CircleAlert, Info, Pencil, Trash2, Upload, ScanLine } from 'lucide-react';
import { api } from '../../services/api';
import { aviso } from '../../components/ui/avisos';
import { confirmar } from '../../components/ui/confirmar';
import { Cargando, EstadoError, EstadoVacio } from '../../components/ui/Estados';
import Boton from '../../components/ui/Boton';
import { ESTADO_FILA, fmtKg, fmtDif, lote2, fechaCorta } from './util';

// Banner por lote: dice en una línea si el escaneo cuadra con CIISA o qué falta.
function BannerLote({ resumen }) {
  const { estado, filas_con_diferencia: n, diferencia } = resumen;
  if (estado === 'cuadrado') {
    return <div className="banner ok"><CircleCheck size={18} aria-hidden="true" /> Lo escaneado cuadra con el reporte de CIISA en kilos y cajas.</div>;
  }
  if (estado === 'con_diferencias') {
    return (
      <div className="banner error" role="alert">
        <CircleAlert size={18} aria-hidden="true" />
        <span>
          {n} {n === 1 ? 'artículo no cuadra' : 'artículos no cuadran'} con CIISA.
          Diferencia total: {fmtDif(diferencia.kilos)} kg y {fmtDif(diferencia.cajas, 0)} cajas (escaneado − CIISA).
        </span>
      </div>
    );
  }
  if (estado === 'falta_ciisa') {
    return <div className="banner info"><Info size={18} aria-hidden="true" /> Falta cargar el reporte de CIISA de este lote: abajo se ve solo lo escaneado.</div>;
  }
  return <div className="banner info"><Info size={18} aria-hidden="true" /> Todavía no se ha escaneado ninguna etiqueta de este lote: abajo se ve solo lo que declara CIISA.</div>;
}

function Pie({ titulo, totales, numLote }) {
  if (!totales) return null;
  return (
    <div className="rp-pie">
      <div className="rp-pie-dato"><span>{titulo}</span>{numLote ? `Total de cajas por el lote # ${numLote}` : 'Totales'}</div>
      <div className="rp-pie-dato"><span>Libras</span>{fmtKg(totales.libras)}</div>
      <div className="rp-pie-dato"><span>Kilos</span>{fmtKg(totales.kilos)}</div>
      <div className="rp-pie-dato"><span>Cajas</span>{totales.cajas}</div>
    </div>
  );
}

function BloqueLote({ fecha, lote, aretes, canEdit, onCorregir, onEliminar }) {
  const enc = lote.encabezado;
  const comparar = Boolean(lote.resumen.ciisa && lote.resumen.escaneado);
  return (
    <section className="card rp-bloque" aria-labelledby={`lote-${lote.lote_cc}`}>
      <div className="card-header">
        <h3 id={`lote-${lote.lote_cc}`}>Lote CC {lote.lote_texto}{lote.arete ? ` · arete ${lote.arete}` : ''}</h3>
        {canEdit && enc && (
          <div className="rp-acciones">
            <Boton tamano="sm" icono={Pencil} onClick={() => onCorregir(enc.id)}>Corregir reporte CIISA</Boton>
            <Boton tamano="sm" variante="peligro" icono={Trash2} onClick={() => onEliminar(enc.id, lote.lote_texto)}>Eliminar</Boton>
          </div>
        )}
      </div>

      <dl className="rp-encabezado">
        <div><dt>Fecha de producción</dt><dd>{fechaCorta(fecha)}</dd></div>
        <div><dt>Num. Lote</dt><dd>{enc?.num_lote || '—'}</dd></div>
        <div><dt>Tipo producción</dt><dd>{enc?.tipo_produccion || '—'}</dd></div>
        <div><dt>Lote CC</dt><dd>{lote.lote_texto}</dd></div>
        <div><dt>Arete</dt><dd>{lote.arete || <span className="rp-tenue">Sin tabla de aretes</span>}</dd></div>
      </dl>

      <BannerLote resumen={lote.resumen} />

      <div className="rp-bloque-cuerpo">
        <div>
          <div className="card rp-tabla-card">
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Artículo</th>
                    <th>Descripción</th>
                    <th className="num">Peso CIISA</th>
                    <th>Unidad</th>
                    <th className="num">Cajas CIISA</th>
                    <th className="num">Kg escaneados</th>
                    <th className="num">Cajas escaneadas</th>
                    {comparar && <th className="num">Dif. kg</th>}
                    {comparar && <th className="num">Dif. cajas</th>}
                    {comparar && <th>Conciliación</th>}
                  </tr>
                </thead>
                <tbody>
                  {lote.filas.map(f => {
                    const est = ESTADO_FILA[f.estado];
                    const clase = !comparar || f.estado === 'cuadra' ? '' : (f.estado === 'diferencia' ? 'rp-fila-dif' : 'rp-fila-falta');
                    return (
                      <tr key={f.articulo} className={clase}>
                        <td><strong>{f.articulo}</strong></td>
                        <td>{f.descripcion || '—'}</td>
                        <td className="num">{fmtKg(f.kg_ciisa)}</td>
                        <td>{f.kg_ciisa === null ? '—' : f.unidad}</td>
                        <td className="num">{f.cajas_ciisa ?? '—'}</td>
                        <td className="num">{fmtKg(f.kg_escaneado)}</td>
                        <td className="num">{f.cajas_escaneado ?? '—'}</td>
                        {comparar && <td className="num">{fmtDif(f.dif_kg)}</td>}
                        {comparar && <td className="num">{fmtDif(f.dif_cajas, 0)}</td>}
                        {comparar && (
                          <td>
                            <span className={`badge ${est.badge}`}><est.Icono size={13} aria-hidden="true" /> {est.texto}</span>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <Pie titulo="Según CIISA" totales={lote.resumen.ciisa} numLote={enc?.num_lote || lote.lote_texto} />
          <Pie titulo="Escaneado en la app" totales={lote.resumen.escaneado} />
          {enc && (
            <p className="rp-tenue rp-nota">
              Reporte CIISA cargado {enc.origen === 'excel_csv' ? `desde ${enc.archivo_nombre || 'archivo'}` : 'a mano'}
              {enc.cargado_por ? ` por ${enc.cargado_por}` : ''}{enc.actualizado ? ` el ${fechaCorta(enc.actualizado.slice(0, 10))} ${enc.actualizado.slice(11)}` : ''}.
            </p>
          )}
        </div>

        <aside aria-label="Aretes por posición">
          <table className="rp-aretes">
            <thead><tr><th>Posición</th><th>Arete</th></tr></thead>
            <tbody>
              {aretes.map(a => (
                <tr key={a.posicion} className={a.posicion === lote.lote_cc ? 'rp-arete-actual' : ''}>
                  <td data-label-fija="">{lote2(a.posicion)}</td>
                  <td data-label-fija="">{a.arete}</td>
                </tr>
              ))}
              {!aretes.length && <tr><td colSpan={2} className="rp-tenue">Sin tabla de aretes para esta fecha.</td></tr>}
            </tbody>
          </table>
        </aside>
      </div>
    </section>
  );
}

export default function VistaReporte({ fecha, setFecha, dias = [], canEdit, onCorregir, irA }) {
  const [lote, setLote] = useState('');
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [descargando, setDescargando] = useState(false);

  const cargar = useCallback(() => {
    setCargando(true);
    setError(null);
    api.getReporteProduccion({ fecha, lote_cc: lote })
      .then(setDatos)
      .catch(e => setError(e.message))
      .finally(() => setCargando(false));
  }, [fecha, lote]);

  useEffect(() => { cargar(); }, [cargar]);

  const descargar = async () => {
    setDescargando(true);
    try {
      await api.descargarReporteProduccion({ fecha, lote_cc: lote }, `reporte-produccion-${fecha}${lote ? `-lote-${lote2(lote)}` : ''}.xlsx`);
    } catch (e) { aviso.error(e.message); } finally { setDescargando(false); }
  };

  const eliminar = async (id, loteTexto) => {
    const ok = await confirmar({
      titulo: `¿Eliminar el reporte de CIISA del lote CC ${loteTexto}?`,
      mensaje: 'Se borran el encabezado y las filas que declaró CIISA. Las etiquetas escaneadas no se tocan.',
      textoConfirmar: 'Eliminar reporte',
      peligro: true,
    });
    if (!ok) return;
    try {
      await api.deleteReporteCiisa(id);
      aviso.ok('Reporte de CIISA eliminado');
      cargar();
    } catch (e) { aviso.error(e.message); }
  };

  const lotesDelDia = datos?.lotes?.map(l => l.lote_cc) || [];

  return (
    <div>
      <div className="filter-bar">
        <label htmlFor="rp-fecha">Fecha de producción</label>
        <input id="rp-fecha" type="date" value={fecha} onChange={e => { setFecha(e.target.value); setLote(''); }} required />
        <label htmlFor="rp-lote">Lote CC</label>
        <select id="rp-lote" value={lote} onChange={e => setLote(e.target.value)}>
          <option value="">Todos los lotes del día</option>
          {[...new Set([...lotesDelDia, ...(lote ? [Number(lote)] : [])])].sort((a, b) => a - b).map(n => (
            <option key={n} value={n}>{lote2(n)}</option>
          ))}
        </select>
        {dias.length > 0 && (
          <>
            <label htmlFor="rp-dias" className="sr-only">Días con datos</label>
            <select id="rp-dias" value="" onChange={e => { if (e.target.value) { setFecha(e.target.value); setLote(''); } }}>
              <option value="">Días con datos…</option>
              {dias.map(d => (
                <option key={d.fecha} value={d.fecha}>
                  {fechaCorta(d.fecha)} · {d.lotes_ciisa} reporte(s) CIISA · {d.etiquetas} etiqueta(s)
                </option>
              ))}
            </select>
          </>
        )}
        <Boton variante="primario" icono={Download} cargando={descargando} onClick={descargar} disabled={!fecha}>Descargar Excel</Boton>
      </div>

      {cargando && <Cargando texto="Cargando reporte…" />}
      {!cargando && error && <EstadoError mensaje={error} onReintentar={cargar} />}
      {!cargando && !error && datos && datos.lotes.length === 0 && (
        <EstadoVacio
          titulo="No hay deshuese registrado para esa fecha y lote"
          texto="Revise la fecha o cargue el reporte de CIISA y escanee las etiquetas de las cajas."
          accion={canEdit && (
            <div className="rp-acciones">
              <Boton icono={Upload} onClick={() => irA('cargar')}>Cargar reporte de CIISA</Boton>
              <Boton icono={ScanLine} onClick={() => irA('escanear')}>Escanear etiquetas</Boton>
            </div>
          )}
        />
      )}
      {!cargando && !error && datos && datos.lotes.map(l => (
        <BloqueLote key={l.lote_cc} fecha={datos.fecha} lote={l} aretes={datos.aretes} canEdit={canEdit} onCorregir={onCorregir} onEliminar={eliminar} />
      ))}
      {!cargando && !error && datos && datos.lotes.length > 0 && (
        <p className="rp-tenue rp-nota">
          Un artículo «cuadra» cuando las cajas son iguales y los kilos difieren en menos de {datos.tolerancia_kg} kg. Diferencias = escaneado − CIISA.
        </p>
      )}
    </div>
  );
}
