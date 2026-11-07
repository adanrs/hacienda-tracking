import { useState, useEffect } from 'react';
import { Plus, Edit, Trash2, MapPin } from 'lucide-react';
import { api } from '../services/api';
import { confirmar } from '../components/ui/confirmar';
import { aviso } from '../components/ui/avisos';
import { Cargando, EstadoError, EstadoVacio, useEstadoCarga } from '../components/ui/Estados';

const estadoBadge = { activo: 'badge-green', inactivo: 'badge-gray', mantenimiento: 'badge-yellow' };

export default function Potreros() {
  const [potreros, setPotreros] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editPotrero, setEditPotrero] = useState(null);
  const [form, setForm] = useState({ estado: 'activo' });

  const [carga, seguir] = useEstadoCarga();
  const load = () => seguir(api.getPotreros().then(setPotreros));
  useEffect(() => { load(); }, []);

  const openNew = () => { setEditPotrero(null); setForm({ estado: 'activo' }); setShowModal(true); };
  const openEdit = (p) => { setEditPotrero(p); setForm({ ...p }); setShowModal(true); };

  const save = async (e) => {
    e.preventDefault();
    try {
      if (editPotrero) {
        await api.updatePotrero(editPotrero.id, form);
      } else {
        await api.createPotrero(form);
      }
      setShowModal(false);
      load();
    } catch (err) { aviso.error(err.message); }
  };

  const remove = async (id) => {
    if (!(await confirmar({ titulo: '¿Eliminar este potrero?', mensaje: 'Esta acción no se puede deshacer.', textoConfirmar: 'Eliminar', peligro: true }))) return;
    try {
      await api.deletePotrero(id);
      aviso.ok('Potrero eliminado');
      load();
    } catch (err) { aviso.error(err.message); }
  };

  return (
    <div>
      <div className="page-header">
        <h2>Potreros</h2>
        <button type="button" className="btn btn-primary" onClick={openNew}><Plus size={16} aria-hidden="true" /> Nuevo potrero</button>
      </div>

      <div className="fichas">
        {potreros.map(p => {
          const ocupacion = p.capacidad_animales > 0 ? p.total_animales / p.capacidad_animales : null;
          return (
            <div className="card" key={p.id}>
              <div className="ficha-encabezado">
                <div>
                  <h3><MapPin size={18} aria-hidden="true" />{p.nombre}</h3>
                  <span className={`badge ${estadoBadge[p.estado] || 'badge-gray'}`}>{p.estado}</span>
                </div>
                <div className="ficha-acciones">
                  <button type="button" className="btn-icon" onClick={() => openEdit(p)} title="Editar potrero" aria-label={`Editar ${p.nombre}`}><Edit size={16} aria-hidden="true" /></button>
                  <button type="button" className="btn-icon peligro" onClick={() => remove(p.id)} title="Eliminar potrero" aria-label={`Eliminar ${p.nombre}`}><Trash2 size={16} aria-hidden="true" /></button>
                </div>
              </div>
              <div className="cifras">
                <div><div className="cifra-valor">{p.total_animales ?? 0}</div><div className="cifra-etiqueta">Animales</div></div>
                <div><div className="cifra-valor">{p.superficie_ha || '-'}</div><div className="cifra-etiqueta">Hectáreas</div></div>
                <div><div className="cifra-valor">{p.capacidad_animales || '-'}</div><div className="cifra-etiqueta">Capacidad</div></div>
              </div>
              {ocupacion !== null && (
                <div>
                  <div className="ocupacion-texto">
                    <span>Ocupación</span>
                    <span>{Math.round(ocupacion * 100)}%{ocupacion > 1 ? ' · sobre la capacidad' : ''}</span>
                  </div>
                  {/* La barra se escala con transform (no con width) para no recalcular el layout. */}
                  <div className="barra" role="img" aria-label={`Ocupación ${Math.round(ocupacion * 100)} %`}>
                    <div className={`barra-relleno ${ocupacion > 1 ? 'excedida' : ''}`} style={{ transform: `scaleX(${Math.min(1, ocupacion)})` }} />
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {carga.cargando && <Cargando texto="Cargando potreros…" />}
        {!carga.cargando && carga.error && <EstadoError mensaje={carga.error} onReintentar={load} />}
        {!carga.cargando && !carga.error && potreros.length === 0 && (
          <EstadoVacio titulo="Todavía no hay potreros" texto="Cree el primero con «Nuevo potrero»." />
        )}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h3>{editPotrero ? 'Editar Potrero' : 'Nuevo Potrero'}</h3><button type="button" className="btn-icon" aria-label="Cerrar" onClick={() => setShowModal(false)}>&times;</button></div>
            <form onSubmit={save}>
              <div className="form-group">
                <label>Nombre *</label>
                <input required value={form.nombre || ''} onChange={e => setForm({ ...form, nombre: e.target.value })} />
              </div>
              <div className="form-row-3">
                <div className="form-group">
                  <label>Superficie (ha)</label>
                  <input type="number" step="0.1" value={form.superficie_ha || ''} onChange={e => setForm({ ...form, superficie_ha: parseFloat(e.target.value) })} />
                </div>
                <div className="form-group">
                  <label>Capacidad</label>
                  <input type="number" value={form.capacidad_animales || ''} onChange={e => setForm({ ...form, capacidad_animales: parseInt(e.target.value) })} />
                </div>
                <div className="form-group">
                  <label>Estado</label>
                  <select value={form.estado} onChange={e => setForm({ ...form, estado: e.target.value })}>
                    <option value="activo">Activo</option>
                    <option value="inactivo">Inactivo</option>
                    <option value="mantenimiento">Mantenimiento</option>
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label>Ubicacion GPS</label>
                <input value={form.ubicacion_gps || ''} onChange={e => setForm({ ...form, ubicacion_gps: e.target.value })} placeholder="lat, lng" />
              </div>
              <div className="form-group">
                <label>Notas</label>
                <textarea rows={2} value={form.notas || ''} onChange={e => setForm({ ...form, notas: e.target.value })} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary">{editPotrero ? 'Guardar' : 'Crear'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
