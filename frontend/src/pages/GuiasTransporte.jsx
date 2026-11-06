import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Truck, Printer, Upload, ArrowLeft, Save, Warehouse } from 'lucide-react';
import { api } from '../services/api';
import { aviso } from '../components/ui/avisos';
import Boton from '../components/ui/Boton';
import { Cargando, EstadoError, EstadoVacio } from '../components/ui/Estados';
import { useAuth } from '../components/AuthContext';

/*
  Guías de transporte finca → planta. Las crea el importador de Ganadero SG (una por día +
  finca + comprador). Aquí se completan los datos del viaje (transportista, placa, guía oficial),
  se imprime la guía y se ve qué animales ya tienen sacrificio registrado.
*/
const fechaCorta = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—');
const kg = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 1 }));
const ESTADOS = { borrador: 'Borrador', despachada: 'Despachada', recibida: 'Recibida en planta', anulada: 'Anulada' };
const CLASE_ESTADO = { borrador: 'badge-gray', despachada: 'badge-blue', recibida: 'badge-green', anulada: 'badge-red' };

export default function GuiasTransporte() {
  const { id } = useParams();
  return id ? <DetalleGuia id={id} /> : <ListaGuias />;
}

function ListaGuias() {
  const [guias, setGuias] = useState(null);
  const [error, setError] = useState(null);
  const cargar = useCallback(() => {
    setError(null);
    api.getGuiasTransporte().then(setGuias).catch(e => setError(e.message));
  }, []);
  useEffect(cargar, [cargar]);

  return (
    <div>
      <div className="page-header">
        <h2>Guías de transporte</h2>
        <Link to="/animales/importar-ganadero-sg" className="btn btn-primary"><Upload size={16} aria-hidden="true" /> Importar desde Ganadero SG</Link>
      </div>
      <div className="card">
        {error && <EstadoError mensaje={error} onReintentar={cargar} />}
        {!error && !guias && <Cargando />}
        {guias && guias.length === 0 && (
          <EstadoVacio icono={Truck} titulo="Todavía no hay guías" texto="Se crean al importar el reporte de salida de Ganadero SG." />
        )}
        {guias && guias.length > 0 && (
          <div className="table-container">
            <table>
              <thead>
                <tr><th>Guía</th><th>Salida</th><th>Finca</th><th>Vendido a</th><th className="num">Animales</th><th className="num">Peso total (kg)</th><th className="num">Sacrificados</th><th>Estado</th></tr>
              </thead>
              <tbody>
                {guias.map(g => (
                  <tr key={g.id}>
                    <td><Link to={`/guias-transporte/${g.id}`}><strong>{g.numero}</strong></Link></td>
                    <td>{fechaCorta(g.fecha_salida)}</td>
                    <td>{g.finca_origen || '—'}</td>
                    <td>{g.comprador || '—'}</td>
                    <td className="num">{g.total_animales}</td>
                    <td className="num">{kg(g.peso_total_kg)}</td>
                    <td className="num">{g.sacrificados} / {g.total_animales}</td>
                    <td><span className={`badge ${CLASE_ESTADO[g.estado]}`}>{ESTADOS[g.estado]}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function DetalleGuia({ id }) {
  const { canEdit } = useAuth();
  const [guia, setGuia] = useState(null);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({});
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(() => {
    setError(null);
    api.getGuiaTransporte(id).then((g) => {
      setGuia(g);
      setForm({ transportista: g.transportista || '', placa_vehiculo: g.placa_vehiculo || '', guia_movilizacion: g.guia_movilizacion || '', estado: g.estado, notas: g.notas || '' });
    }).catch(e => setError(e.message));
  }, [id]);
  useEffect(cargar, [cargar]);

  const guardar = async (e) => {
    e.preventDefault();
    setGuardando(true);
    try {
      await api.updateGuiaTransporte(id, form);
      aviso.ok('Guía guardada');
      cargar();
    } catch (err) { aviso.error(err.message); } finally { setGuardando(false); }
  };

  if (error) return <EstadoError mensaje={error} onReintentar={cargar} />;
  if (!guia) return <Cargando />;
  const pendientes = guia.animales.filter(a => !a.sacrificio_id).length;

  return (
    <div>
      <div className="page-header no-print">
        <h2>Guía {guia.numero}</h2>
        <div className="rp-acciones">
          <Link to="/guias-transporte" className="btn btn-secondary"><ArrowLeft size={16} aria-hidden="true" /> Guías</Link>
          {pendientes > 0 && <Link to={`/sacrificio/importar-ciisa?guia=${guia.id}`} className="btn btn-secondary"><Warehouse size={16} aria-hidden="true" /> Registrar sacrificio</Link>}
          <Boton icono={Printer} onClick={() => window.print()}>Imprimir guía</Boton>
        </div>
      </div>

      <div className="card print-area guia-impresion">
        <div className="guia-encabezado">
          <div>
            <h3 style={{ margin: 0 }}>Guía de transporte de ganado {guia.numero}</h3>
            <div className="rp-tenue">Wagyu Cross · trazabilidad</div>
          </div>
          <span className={`badge ${CLASE_ESTADO[guia.estado]}`}>{ESTADOS[guia.estado]}</span>
        </div>
        <dl className="rp-encabezado">
          <div><dt>Fecha de salida</dt><dd>{fechaCorta(guia.fecha_salida)}</dd></div>
          <div><dt>Finca de origen</dt><dd>{guia.finca_origen || '—'}</dd></div>
          <div><dt>Destino</dt><dd>{guia.destino || '—'}</dd></div>
          <div><dt>Vendido a</dt><dd>{guia.comprador || '—'}</dd></div>
          <div><dt>Animales</dt><dd>{guia.total_animales}</dd></div>
          <div><dt>Peso total</dt><dd>{kg(guia.peso_total_kg)} kg</dd></div>
          <div><dt>Transportista</dt><dd>{guia.transportista || '—'}</dd></div>
          <div><dt>Placa</dt><dd>{guia.placa_vehiculo || '—'}</dd></div>
          <div><dt>Guía oficial</dt><dd>{guia.guia_movilizacion || '—'}</dd></div>
        </dl>
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th className="num">#</th><th>Arete</th><th>I.E.</th><th>Sexo</th><th>Raza</th><th>Nacimiento</th>
                <th>Madre</th><th>Padre</th><th>Potrero</th><th className="num">Días pot.</th><th className="num">gr/día</th>
                <th>Última vacuna</th><th className="num">Peso salida (kg)</th><th className="no-print">Sacrificio</th>
              </tr>
            </thead>
            <tbody>
              {guia.animales.map((a, i) => (
                <tr key={a.id}>
                  <td className="num">{i + 1}</td>
                  <td><Link to={`/animales/${a.animal_id}`}><strong>{a.arete}</strong></Link></td>
                  <td><code style={{ fontSize: '0.8em' }}>{a.identificacion_electronica || '—'}</code></td>
                  <td>{a.sexo === 'macho' ? 'M' : a.sexo === 'hembra' ? 'H' : '—'}</td>
                  <td>{a.raza || '—'}</td>
                  <td>{fechaCorta(a.fecha_nacimiento)}</td>
                  <td>{a.madre_numero || '—'}</td>
                  <td>{a.padre_numero || '—'}</td>
                  <td>{a.potrero || '—'}</td>
                  <td className="num">{a.dias_potrero ?? '—'}</td>
                  <td className="num">{a.gr_dia_vida != null ? kg(a.gr_dia_vida) : '—'}</td>
                  <td>{a.ultima_vacuna ? `${a.ultima_vacuna} (${fechaCorta(a.fecha_ultima_vacuna)})` : '—'}</td>
                  <td className="num"><strong>{kg(a.peso_salida_kg)}</strong></td>
                  <td className="no-print">{a.sacrificio_id ? <span className="badge badge-green">Canal {a.numero_canal || 's/n'}</span> : <span className="badge badge-gray">Pendiente</span>}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td colSpan={12}><strong>Total</strong></td><td className="num"><strong>{kg(guia.peso_total_kg)}</strong></td><td className="no-print" /></tr>
            </tfoot>
          </table>
        </div>
        <div className="guia-firmas">
          <div>Entrega (finca)</div><div>Transportista</div><div>Recibe (planta)</div>
        </div>
      </div>

      {canEdit && (
        <form className="card no-print" onSubmit={guardar}>
          <h3 className="rp-subtitulo">Datos del viaje</h3>
          <div className="form-row">
            <div className="form-group"><label htmlFor="g-trans">Transportista</label><input id="g-trans" value={form.transportista} onChange={e => setForm({ ...form, transportista: e.target.value })} /></div>
            <div className="form-group"><label htmlFor="g-placa">Placa</label><input id="g-placa" value={form.placa_vehiculo} onChange={e => setForm({ ...form, placa_vehiculo: e.target.value })} /></div>
            <div className="form-group"><label htmlFor="g-oficial">N.º de guía oficial (SENASA)</label><input id="g-oficial" value={form.guia_movilizacion} onChange={e => setForm({ ...form, guia_movilizacion: e.target.value })} /></div>
            <div className="form-group">
              <label htmlFor="g-estado">Estado</label>
              <select id="g-estado" value={form.estado} onChange={e => setForm({ ...form, estado: e.target.value })}>
                {Object.entries(ESTADOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </div>
          <div className="form-group"><label htmlFor="g-notas">Notas</label><textarea id="g-notas" rows={2} value={form.notas} onChange={e => setForm({ ...form, notas: e.target.value })} /></div>
          <Boton type="submit" variante="primario" icono={Save} cargando={guardando}>Guardar</Boton>
        </form>
      )}
    </div>
  );
}
