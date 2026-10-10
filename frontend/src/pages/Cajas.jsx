import { useState, useEffect } from 'react';
import { Boxes, Scan, Check, Barcode } from 'lucide-react';
import { api } from '../services/api';
import { aviso } from '../components/ui/avisos';
import { confirmar } from '../components/ui/confirmar';
import Escaner from '../components/ui/Escaner';
import { FilaEstado } from '../components/ui/Estados';
import { formatDate } from '../components/DateFormat';

const estadoBadge = { abierta: 'badge-yellow', cerrada: 'badge-green', despachada: 'badge-blue', devuelta: 'badge-red' };

export default function Cajas() {
  const [cajas, setCajas] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState(null);
  const [filterEstado, setFilterEstado] = useState('');
  const [selected, setSelected] = useState(null);
  const [stickers, setStickers] = useState([]);
  const [showScan, setShowScan] = useState(false);
  const [scanResult, setScanResult] = useState(null);

  const load = () => {
    const params = filterEstado ? { estado: filterEstado } : {};
    setCargando(true);
    setErrorCarga(null);
    api.getCajas(params)
      .then(setCajas)
      .catch(err => setErrorCarga(err.message))
      .finally(() => setCargando(false));
  };

  useEffect(() => { load(); }, [filterEstado]);

  const openCaja = async (c) => {
    setSelected(c);
    try {
      const full = await api.getCaja(c.id);
      setStickers(full.stickers || []);
    } catch (err) { aviso.error(err.message); }
  };

  const cerrar = async () => {
    if (!(await confirmar({ titulo: `¿Cerrar la caja ${selected.codigo}?`, mensaje: 'Una caja cerrada ya no acepta etiquetas nuevas.', textoConfirmar: 'Cerrar caja' }))) return;
    try {
      await api.cerrarCaja(selected.id);
      aviso.ok(`Caja ${selected.codigo} cerrada`);
      setSelected(null);
      load();
    } catch (err) { aviso.error(err.message); }
  };

  const imprimir = () => window.print();

  // Lectura de la pistola: la respuesta se muestra grande en el componente Escaner.
  const leerEtiqueta = async (codigo) => {
    try {
      const res = await api.scanSticker(codigo);
      setScanResult(res);
      const peso = res.peso_kg ? `${parseFloat(res.peso_kg).toFixed(2)} kg` : null;
      return {
        ok: true,
        titulo: 'Etiqueta OK',
        detalle: [res.tipo_corte, peso, res.caja_codigo && `Caja ${res.caja_codigo}`].filter(Boolean).join(' · '),
      };
    } catch (err) {
      setScanResult(null);
      throw err;
    }
  };

  const onFilaKeyDown = (e, c) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCaja(c); }
  };

  return (
    <div>
      <style>{`@media print { body * { visibility: hidden; } .print-area, .print-area * { visibility: visible; } .print-area { position: absolute; left: 0; top: 0; width: 100%; } }`}</style>

      <div className="page-header">
        <h2>Cajas y etiquetas</h2>
        <button type="button" className="btn btn-primary btn-lg" onClick={() => { setShowScan(true); setScanResult(null); }}><Scan size={20} aria-hidden="true" /> Escanear etiqueta</button>
      </div>

      <div className="filter-bar">
        <label className="sr-only" htmlFor="filtro-estado-caja">Filtrar por estado</label>
        <select id="filtro-estado-caja" value={filterEstado} onChange={e => setFilterEstado(e.target.value)}>
          <option value="">Todos los estados</option>
          <option value="abierta">Abierta</option>
          <option value="cerrada">Cerrada</option>
          <option value="despachada">Despachada</option>
          <option value="devuelta">Devuelta</option>
        </select>
      </div>

      <div className="card">
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Código</th>
                <th>Tipo de corte</th>
                <th>Peso total</th>
                <th>Etiquetas</th>
                <th>Estado</th>
                <th>Bodega</th>
                <th>Fecha de empaque</th>
              </tr>
            </thead>
            <tbody>
              {!cargando && !errorCarga && cajas.map(c => (
                <tr
                  key={c.id}
                  className="fila-clic"
                  tabIndex={0}
                  aria-label={`Ver caja ${c.codigo}`}
                  onClick={() => openCaja(c)}
                  onKeyDown={e => onFilaKeyDown(e, c)}
                >
                  <td><strong>{c.codigo}</strong></td>
                  <td>{c.tipo_corte || '-'}</td>
                  <td>{c.peso_total_kg ? `${parseFloat(c.peso_total_kg).toFixed(2)} kg` : '-'}</td>
                  <td>{c.num_stickers || 0}</td>
                  <td><span className={`badge ${estadoBadge[c.estado] || 'badge-gray'}`}>{c.estado}</span></td>
                  <td>{c.bodega_codigo || '-'}</td>
                  <td>{formatDate(c.fecha_empaque)}</td>
                </tr>
              ))}
              <FilaEstado
                columnas={7}
                cargando={cargando}
                error={errorCarga}
                onReintentar={load}
                vacio={cajas.length === 0}
                tituloVacio={filterEstado ? `No hay cajas en estado «${filterEstado}»` : 'Todavía no hay cajas'}
                textoVacio={filterEstado ? 'Pruebe con otro estado o con «Todos los estados».' : 'Las cajas se crean desde Porcionado al generar las etiquetas.'}
              />
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <div className="modal-overlay" onClick={() => setSelected(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 700 }}>
            <div className="modal-header">
              <h3><Boxes size={18} style={{ verticalAlign: 'middle' }} /> Caja {selected.codigo}</h3>
              <button type="button" className="btn-icon" aria-label="Cerrar" onClick={() => setSelected(null)}>&times;</button>
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              <span className={`badge ${estadoBadge[selected.estado] || 'badge-gray'}`}>{selected.estado}</span>
              <span>Tipo: <strong>{selected.tipo_corte || '-'}</strong></span>
              <span>Peso: <strong>{selected.peso_total_kg ? `${parseFloat(selected.peso_total_kg).toFixed(2)} kg` : '-'}</strong></span>
            </div>

            <div className="print-area">
              <h4 style={{ marginBottom: 10 }}>Etiquetas ({stickers.length})</h4>
              {stickers.map(s => {
                const kg = s.peso_kg ? parseFloat(s.peso_kg) : 0;
                const lb = (kg * 2.20462).toFixed(2);
                return (
                  <div key={s.id} style={{ padding: 10, border: '1px solid var(--border)', borderRadius: 'var(--radius)', marginBottom: 8 }}>
                    <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '0.95rem', lineHeight: 1.5 }}>
                      <div>CUE: {s.codigo_cue || '-'}</div>
                      <div>BOX: {s.codigo_box || '-'}</div>
                      <div>PESO: {s.peso_kg ? `${kg.toFixed(2)} KG / ${lb} LB` : '-'}</div>
                      <div>LOT: {s.codigo_lot || '-'}</div>
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: 6 }}>
                      <div>{s.tipo_corte || '-'}</div>
                      <div>Empaque: {formatDate(s.fecha_empaque)}</div>
                      <div>Mejor consumir antes: {formatDate(s.fecha_mejor_antes)}</div>
                      <div>Congelar hasta: {formatDate(s.fecha_congelar_hasta)}</div>
                      {s.codigo_barras && (
                        <div style={{ marginTop: 4, fontFamily: 'monospace' }}>
                          <Barcode size={12} style={{ verticalAlign: 'middle' }} /> {s.codigo_barras}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              {stickers.length === 0 && <div className="empty-state">Esta caja todavía no tiene etiquetas.</div>}
            </div>

            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={imprimir}><Barcode size={16} aria-hidden="true" /> Imprimir etiquetas</button>
              {selected.estado === 'abierta' && <button type="button" className="btn btn-primary" onClick={cerrar}><Check size={16} aria-hidden="true" /> Cerrar caja</button>}
            </div>
          </div>
        </div>
      )}

      {showScan && (
        // Sin cierre por toque fuera: con guantes es fácil tocar el fondo por error. Escape o «Terminar» cierran.
        <div className="modal-overlay">
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="titulo-escaneo" onKeyDown={e => { if (e.key === 'Escape') setShowScan(false); }} style={{ maxWidth: 720 }}>
            <div className="modal-header">
              <h3 id="titulo-escaneo"><Scan size={20} aria-hidden="true" /> Escanear etiquetas</h3>
              <button type="button" className="btn-icon" aria-label="Cerrar" onClick={() => setShowScan(false)}>&times;</button>
            </div>
            <Escaner
              etiqueta="Código de barras de la etiqueta"
              onLeer={leerEtiqueta}
              ayuda="Dispare la pistola: cada lectura se verifica al instante y el campo queda listo para la siguiente."
            />
            {scanResult && (
              <div className="banner" style={{ display: 'block' }}>
                <div><strong>Animal:</strong> {scanResult.numero_trazabilidad || '-'}</div>
                <div><strong>Corte:</strong> {scanResult.tipo_corte || '-'}</div>
                {scanResult.peso_kg && (
                  <div><strong>Peso:</strong> {parseFloat(scanResult.peso_kg).toFixed(2)} KG / {(parseFloat(scanResult.peso_kg) * 2.20462).toFixed(2)} LB</div>
                )}
                {scanResult.codigo_cue && <div><strong>CUE:</strong> {scanResult.codigo_cue}</div>}
                {scanResult.codigo_box && <div><strong>BOX:</strong> {scanResult.codigo_box}</div>}
                {scanResult.codigo_lot && <div><strong>LOT:</strong> {scanResult.codigo_lot}</div>}
                {scanResult.caja_codigo && <div><strong>Caja:</strong> {scanResult.caja_codigo}</div>}
                {scanResult.fecha_empaque && <div><strong>Empaque:</strong> {formatDate(scanResult.fecha_empaque)}</div>}
                {scanResult.fecha_mejor_antes && <div><strong>Mejor consumir antes:</strong> {formatDate(scanResult.fecha_mejor_antes)}</div>}
                {scanResult.fecha_congelar_hasta && <div><strong>Congelar hasta:</strong> {formatDate(scanResult.fecha_congelar_hasta)}</div>}
              </div>
            )}
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary btn-lg" onClick={() => setShowScan(false)}>Terminar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
