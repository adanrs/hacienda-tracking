import { useState, useEffect } from 'react';
import { Plus, Edit, Trash2, Snowflake } from 'lucide-react';
import { api } from '../services/api';
import { confirmar } from '../components/ui/confirmar';
import { aviso } from '../components/ui/avisos';
import { Cargando, EstadoError, EstadoVacio, useEstadoCarga } from '../components/ui/Estados';

const tipoBadge = { custodia: 'badge-blue', maduracion: 'badge-yellow', deshuese: 'badge-gray', porcionado: 'badge-green', despacho: 'badge-gray' };
// Mismos valores que el ENUM bodegas.tipo (backend/src/models/database.js); el backend
// rechaza cualquier otro con 400.
const tipos = [
  { valor: 'deshuese', etiqueta: 'Deshuese' },
  { valor: 'custodia', etiqueta: 'Custodia' },
  { valor: 'maduracion', etiqueta: 'Maduración' },
  { valor: 'porcionado', etiqueta: 'Porcionado' },
  { valor: 'despacho', etiqueta: 'Despacho' },
];

export default function Bodegas() {
  const [bodegas, setBodegas] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [form, setForm] = useState({});

  const [carga, seguir] = useEstadoCarga();
  const load = () => seguir(api.getBodegas().then(setBodegas));
  useEffect(() => { load(); }, []);

  const openNew = () => { setEditItem(null); setForm({ tipo: 'custodia', activa: 1 }); setShowModal(true); };
  const openEdit = (b) => { setEditItem(b); setForm({ ...b }); setShowModal(true); };

  const save = async (e) => {
    e.preventDefault();
    try {
      if (editItem) await api.updateBodega(editItem.id, form);
      else await api.createBodega(form);
      setShowModal(false);
      load();
    } catch (err) { aviso.error(err.message); }
  };

  const remove = async (id) => {
    if (!(await confirmar({ titulo: '¿Eliminar esta bodega?', mensaje: 'Esta acción no se puede deshacer.', textoConfirmar: 'Eliminar', peligro: true }))) return;
    try { await api.deleteBodega(id); load(); } catch (err) { aviso.error(err.message); }
  };

  return (
    <div>
      <div className="page-header">
        <h2>Bodegas</h2>
        <button type="button" className="btn btn-primary" onClick={openNew}><Plus size={16} aria-hidden="true" /> Nueva bodega</button>
      </div>

      <div className="fichas">
        {bodegas.map(b => (
          <div className="card" key={b.id}>
            <div className="ficha-encabezado">
              <div>
                <h3><Snowflake size={18} aria-hidden="true" />{b.codigo}</h3>
                <div className="ficha-sub">{b.nombre}</div>
              </div>
              <div className="ficha-acciones">
                <button type="button" className="btn-icon" onClick={() => openEdit(b)} title="Editar bodega" aria-label={`Editar bodega ${b.codigo}`}><Edit size={16} aria-hidden="true" /></button>
                <button type="button" className="btn-icon peligro" onClick={() => remove(b.id)} title="Eliminar bodega" aria-label={`Eliminar bodega ${b.codigo}`}><Trash2 size={16} aria-hidden="true" /></button>
              </div>
            </div>
            <div className="ficha-badges">
              <span className={`badge ${tipoBadge[b.tipo] || 'badge-gray'}`}>{b.tipo}</span>
              <span className={`badge ${b.activa ? 'badge-green' : 'badge-gray'}`}>{b.activa ? 'Activa' : 'Inactiva'}</span>
            </div>
            <div className="cifras">
              <div>
                <div className="cifra-valor">{b.temperatura_c !== null && b.temperatura_c !== undefined ? `${parseFloat(b.temperatura_c).toFixed(1)} °C` : '-'}</div>
                <div className="cifra-etiqueta">Temperatura</div>
              </div>
              <div>
                <div className="cifra-valor">{b.capacidad_kg ? `${parseFloat(b.capacidad_kg).toFixed(0)} kg` : '-'}</div>
                <div className="cifra-etiqueta">Capacidad</div>
              </div>
            </div>
            {b.notas && <div className="ficha-sub">{b.notas}</div>}
          </div>
        ))}
        {carga.cargando && <Cargando texto="Cargando bodegas…" />}
        {!carga.cargando && carga.error && <EstadoError mensaje={carga.error} onReintentar={load} />}
        {!carga.cargando && !carga.error && bodegas.length === 0 && (
          <EstadoVacio titulo="Todavía no hay bodegas" texto="Cree la primera con «Nueva bodega»." />
        )}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editItem ? 'Editar Bodega' : 'Nueva Bodega'}</h3>
              <button type="button" className="btn-icon" aria-label="Cerrar" onClick={() => setShowModal(false)}>&times;</button>
            </div>
            <form onSubmit={save}>
              <div className="form-row">
                <div className="form-group">
                  <label>Codigo *</label>
                  <input required value={form.codigo || ''} onChange={e => setForm({ ...form, codigo: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Nombre *</label>
                  <input required value={form.nombre || ''} onChange={e => setForm({ ...form, nombre: e.target.value })} />
                </div>
              </div>
              <div className="form-row-3">
                <div className="form-group">
                  <label>Tipo *</label>
                  <select value={form.tipo || 'custodia'} onChange={e => setForm({ ...form, tipo: e.target.value })}>
                    {tipos.map(t => <option key={t.valor} value={t.valor}>{t.etiqueta}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Temperatura (°C)</label>
                  <input type="number" step="0.1" value={form.temperatura_c ?? ''} onChange={e => setForm({ ...form, temperatura_c: parseFloat(e.target.value) })} />
                </div>
                <div className="form-group">
                  <label>Capacidad (kg)</label>
                  <input type="number" step="0.1" value={form.capacidad_kg ?? ''} onChange={e => setForm({ ...form, capacidad_kg: parseFloat(e.target.value) })} />
                </div>
              </div>
              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input type="checkbox" checked={!!form.activa} onChange={e => setForm({ ...form, activa: e.target.checked ? 1 : 0 })} />
                  Activa
                </label>
              </div>
              <div className="form-group">
                <label>Notas</label>
                <textarea rows={2} value={form.notas || ''} onChange={e => setForm({ ...form, notas: e.target.value })} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary">{editItem ? 'Guardar' : 'Crear'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
