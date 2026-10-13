import { useCallback, useEffect, useState } from 'react';
import { Trash2, Box, Beef, Copy } from 'lucide-react';
import { api } from '../../services/api';
import { aviso } from '../../components/ui/avisos';
import { confirmar } from '../../components/ui/confirmar';
import Escaner from '../../components/ui/Escaner';
import Boton from '../../components/ui/Boton';
import { FilaEstado } from '../../components/ui/Estados';
import { fmtKg, lote2, fechaCorta } from './util';

/*
  Escaneo de las etiquetas de deshuese (caja master y primal). Cada lectura es una caja del
  reporte: aporta artículo, kg, fecha del deshuese y lote CC (todo impreso en la etiqueta).
  Dos casos piden una decisión del operador y se resuelven con botones grandes bajo el escáner:
    - etiqueta ambigua (25 dígitos que pueden ser caja o primal);
    - caja idéntica a otra ya escaneada (mismo artículo, peso, fecha y lote): ¿es otra caja?
*/
export default function EscaneoDeshuese({ fecha, setFecha, canEdit }) {
  const [lecturas, setLecturas] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [soloFecha, setSoloFecha] = useState(true);
  const [pendiente, setPendiente] = useState(null); // { codigo, motivo: 'ambigua'|'duplicada', mensaje }

  const cargar = useCallback(() => {
    setCargando(true);
    setError(null);
    api.getEscaneosProduccion({ fecha })
      .then(setLecturas)
      .catch(e => setError(e.message))
      .finally(() => setCargando(false));
  }, [fecha]);
  useEffect(() => { cargar(); }, [cargar]);

  const enviar = async (datos) => {
    const r = await api.escanearProduccion({ ...datos, fecha_esperada: soloFecha ? fecha : undefined });
    cargar();
    return {
      ok: true,
      titulo: `${r.descripcion || r.articulo_codigo} · ${fmtKg(r.peso_kg)} kg`,
      detalle: `${r.tipo === 'caja' ? 'Caja' : 'Primal'} del lote CC ${lote2(r.lote_cc)}${r.arete ? ` (arete ${r.arete})` : ''} · deshuese ${fechaCorta(r.fecha_deshuese)} · `
        + `en este lote van ${r.lote.cajas} cajas, ${fmtKg(r.lote.kg)} kg${r.fecha_ambigua ? ' · Revise la fecha: el día es ≤ 12' : ''}`,
    };
  };

  const leer = async (codigo) => {
    setPendiente(null);
    try {
      return await enviar({ codigo });
    } catch (e) {
      const motivo = e.datos?.motivo;
      if (motivo === 'ambigua' || (motivo === 'duplicada' && e.datos?.puede_confirmar)) {
        setPendiente({ codigo, motivo, mensaje: e.message });
        return { ok: false, titulo: motivo === 'ambigua' ? '¿Es caja o primal?' : 'Etiqueta repetida', detalle: 'Elija abajo qué hacer con esta lectura.' };
      }
      throw e;
    }
  };

  const resolver = async (extra) => {
    const p = pendiente;
    setPendiente(null);
    try {
      const r = await enviar({ codigo: p.codigo, ...extra });
      aviso.ok(r.detalle, { titulo: r.titulo });
    } catch (e) {
      aviso.error(e.message, { titulo: 'No se registró' });
    }
  };

  const quitar = async (l) => {
    const ok = await confirmar({ titulo: '¿Quitar esta lectura?', mensaje: `${l.descripcion || l.articulo_codigo}, ${fmtKg(l.peso_kg)} kg, lote CC ${lote2(l.lote_cc)}.`, textoConfirmar: 'Quitar', peligro: true });
    if (!ok) return;
    try { await api.deleteEscaneoProduccion(l.id); aviso.ok('Lectura quitada'); cargar(); } catch (e) { aviso.error(e.message); }
  };

  // Resumen por lote CC de lo escaneado en la fecha.
  const porLote = Object.values(lecturas.reduce((acc, l) => {
    const k = l.lote_cc;
    acc[k] = acc[k] || { lote: k, cajas: 0, kg: 0 };
    acc[k].cajas += 1;
    acc[k].kg += l.peso_kg;
    return acc;
  }, {})).sort((a, b) => a.lote - b.lote);

  return (
    <div>
      <div className="filter-bar">
        <label htmlFor="rp-fecha-esc">Fecha del deshuese</label>
        <input id="rp-fecha-esc" type="date" value={fecha} onChange={e => setFecha(e.target.value)} />
        {canEdit && (
          <label className="rp-check">
            <input type="checkbox" checked={soloFecha} onChange={e => setSoloFecha(e.target.checked)} />
            Rechazar etiquetas de otra fecha
          </label>
        )}
      </div>

      {canEdit ? (
        <div className="card">
          <Escaner
            etiqueta="Etiqueta de caja o primal de deshuese"
            onLeer={leer}
            ayuda="Dispare la pistola sobre cada caja. Cada lectura suma una caja al reporte del lote que trae impreso."
          />
          {pendiente?.motivo === 'ambigua' && (
            <div className="rp-decision" role="group" aria-label="Tipo de etiqueta">
              <p>{pendiente.mensaje}</p>
              <Boton tamano="lg" variante="primario" icono={Box} onClick={() => resolver({ tipo: 'caja' })}>Es una caja</Boton>
              <Boton tamano="lg" variante="primario" icono={Beef} onClick={() => resolver({ tipo: 'primal' })}>Es un primal</Boton>
              <Boton tamano="lg" onClick={() => setPendiente(null)}>Descartar</Boton>
            </div>
          )}
          {pendiente?.motivo === 'duplicada' && (
            <div className="rp-decision" role="group" aria-label="Etiqueta repetida">
              <p>{pendiente.mensaje} Si tiene en la mano OTRA caja con exactamente la misma etiqueta (mismo artículo y peso), regístrela; si es la misma caja, descarte.</p>
              <Boton tamano="lg" variante="primario" icono={Copy} onClick={() => resolver({ otra_caja: true })}>Sí, es otra caja</Boton>
              <Boton tamano="lg" onClick={() => setPendiente(null)}>Es la misma: descartar</Boton>
            </div>
          )}
        </div>
      ) : (
        <div className="banner info">Su usuario es de solo lectura: puede ver las lecturas, pero no escanear.</div>
      )}

      {porLote.length > 0 && (
        <div className="rp-resumen-lotes" aria-label="Escaneado por lote CC">
          {porLote.map(p => (
            <div key={p.lote} className="stat-card rp-mini">
              <div>
                <div className="stat-label">Lote CC {lote2(p.lote)}</div>
                <div className="stat-value">{p.cajas} <small>cajas</small></div>
                <div className="rp-tenue">{fmtKg(p.kg)} kg</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <div className="table-container">
          <table>
            <thead>
              <tr><th>Hora</th><th>Lote CC</th><th>Artículo</th><th>Descripción</th><th className="num">Kg</th><th>Tipo</th><th>Escaneó</th>{canEdit && <th><span className="sr-only">Quitar</span></th>}</tr>
            </thead>
            <tbody>
              {!cargando && !error && lecturas.map(l => (
                <tr key={l.id}>
                  <td>{l.escaneado?.slice(11) || '—'}</td>
                  <td><strong>{lote2(l.lote_cc)}</strong></td>
                  <td>{l.articulo_codigo}</td>
                  <td>{l.descripcion || '—'}{l.copia > 1 ? ` (caja repetida ${l.copia})` : ''}</td>
                  <td className="num">{fmtKg(l.peso_kg)}</td>
                  <td>{l.tipo === 'caja' ? 'Caja' : 'Primal'}</td>
                  <td>{l.escaneado_por || '—'}</td>
                  {canEdit && <td><button type="button" className="btn-icon" aria-label={`Quitar lectura ${l.articulo_codigo} ${fmtKg(l.peso_kg)} kg`} onClick={() => quitar(l)}><Trash2 size={16} aria-hidden="true" /></button></td>}
                </tr>
              ))}
              <FilaEstado
                columnas={canEdit ? 8 : 7}
                cargando={cargando}
                error={error}
                onReintentar={cargar}
                vacio={lecturas.length === 0}
                tituloVacio="Todavía no hay etiquetas escaneadas para esta fecha"
                textoVacio="Las cajas y primales del deshuese aparecen aquí al escanearlos."
              />
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
