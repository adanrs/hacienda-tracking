import { useState, useEffect } from 'react';
import { Boxes, Scan, Check, Barcode } from 'lucide-react';
import { api } from '../services/api';
import { formatDate } from '../components/DateFormat';

const estadoBadge = { abierta: 'badge-yellow', cerrada: 'badge-green', despachada: 'badge-blue', devuelta: 'badge-red' };

export default function Cajas() {
  const [cajas, setCajas] = useState([]);
  const [filterEstado, setFilterEstado] = useState('');
  const [selected, setSelected] = useState(null);
  const [stickers, setStickers] = useState([]);
  const [showScan, setShowScan] = useState(false);
  const [scanCode, setScanCode] = useState('');
  const [scanResult, setScanResult] = useState(null);

  const load = () => {
    const params = filterEstado ? { estado: filterEstado } : {};
    api.getCajas(params).then(setCajas).catch(console.error);
  };

  useEffect(() => { load(); }, [filterEstado]);

  const openCaja = async (c) => {
    setSelected(c);
    try {
      const full = await api.getCaja(c.id);
      setStickers(full.stickers || []);
    } catch (err) { alert(err.message); }
  };

  const cerrar = async () => {
    try { await api.cerrarCaja(selected.id); setSelected(null); load(); } catch (err) { alert(err.message); }
  };

  const imprimir = () => window.print();

  const runScan = async (e) => {
    e.preventDefault();
    try {
      const res = await api.scanSticker(scanCode);
      setScanResult(res);
    } catch (err) { alert(err.message); setScanResult(null); }
  };

  return (
    <div>
      <style>{`@media print { body * { visibility: hidden; } .print-area, .print-area * { visibility: visible; } .print-area { position: absolute; left: 0; top: 0; width: 100%; } }`}</style>

      <div className="page-header">
        <h2>Cajas</h2>
        <button className="btn btn-primary" onClick={() => { setShowScan(true); setScanCode(''); setScanResult(null); }}><Scan size={16} /> Escanear Sticker</button>
      </div>

      <div className="filter-bar">
        <select value={filterEstado} onChange={e => setFilterEstado(e.target.value)}>
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
                <th>Codigo</th>
                <th>Tipo Corte</th>
                <th>Peso Total</th>
                <th>Stickers</th>
                <th>Estado</th>
                <th>Bodega</th>
                <th>Fecha Empaque</th>
              </tr>
            </thead>
            <tbody>
              {cajas.map(c => (
                <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => openCaja(c)}>
                  <td><strong>{c.codigo}</strong></td>
                  <td>{c.tipo_corte || '-'}</td>
                  <td>{c.peso_total_kg ? `${parseFloat(c.peso_total_kg).toFixed(2)} kg` : '-'}</td>
                  <td>{c.num_stickers || 0}</td>
                  <td><span className={`badge ${estadoBadge[c.estado] || 'badge-gray'}`}>{c.estado}</span></td>
                  <td>{c.bodega_codigo || '-'}</td>
                  <td>{formatDate(c.fecha_empaque)}</td>
                </tr>
              ))}
              {cajas.length === 0 && <tr><td colSpan={7} className="empty-state">Sin cajas</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <div className="modal-overlay" onClick={() => setSelected(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 700 }}>
            <div className="modal-header">
              <h3><Boxes size={18} style={{ verticalAlign: 'middle' }} /> Caja {selected.codigo}</h3>
              <button className="btn-icon" onClick={() => setSelected(null)}>&times;</button>
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              <span className={`badge ${estadoBadge[selected.estado] || 'badge-gray'}`}>{selected.estado}</span>
              <span>Tipo: <strong>{selected.tipo_corte || '-'}</strong></span>
              <span>Peso: <strong>{selected.peso_total_kg ? `${parseFloat(selected.peso_total_kg).toFixed(2)} kg` : '-'}</strong></span>
            </div>

            <div className="print-area">
              <h4 style={{ marginBottom: 10 }}>Stickers ({stickers.length})</h4>
              {stickers.map(s => {
                const kg = s.peso_kg ? parseFloat(s.peso_kg) : 0;
                const lb = (kg * 2.20462).toFixed(2);
                return (
                  <div key={s.id} style={{ padding: 10, border: '1px solid #e5e7eb', borderRadius: 6, marginBottom: 8 }}>
                    <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '0.95rem', lineHeight: 1.5 }}>
                      <div>CUE: {s.codigo_cue || '-'}</div>
                      <div>BOX: {s.codigo_box || '-'}</div>
                      <div>PESO: {s.peso_kg ? `${kg.toFixed(2)} KG / ${lb} LB` : '-'}</div>
                      <div>LOT: {s.codigo_lot || '-'}</div>
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: 6 }}>
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
              {stickers.length === 0 && <div className="empty-state">Sin stickers</div>}
            </div>

            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={imprimir}><Barcode size={14} /> Ver codigos de barras</button>
              {selected.estado === 'abierta' && <button type="button" className="btn btn-primary" onClick={cerrar}><Check size={14} /> Cerrar caja</button>}
            </div>
          </div>
        </div>
      )}

      {showScan && (
        <div className="modal-overlay" onClick={() => setShowScan(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3><Scan size={18} style={{ verticalAlign: 'middle' }} /> Escanear Sticker</h3>
              <button className="btn-icon" onClick={() => setShowScan(false)}>&times;</button>
            </div>
            <form onSubmit={runScan}>
              <div className="form-group">
                <label>Codigo de barras</label>
                <input autoFocus value={scanCode} onChange={e => setScanCode(e.target.value)} style={{ fontFamily: 'monospace' }} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowScan(false)}>Cerrar</button>
                <button type="submit" className="btn btn-primary">Buscar</button>
              </div>
            </form>
            {scanResult && (
              <div style={{ marginTop: 12, padding: 12, background: '#f0fdf4', borderRadius: 8 }}>
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
          </div>
        </div>
      )}
    </div>
  );
}
