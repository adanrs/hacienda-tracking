import { useState, useEffect } from 'react';
import { Plus, Edit, Trash2, Shield, ShieldCheck, Eye } from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../components/AuthContext';
import { formatDate } from '../components/DateFormat';

const rolBadge = { admin: 'badge-red', operador: 'badge-blue', viewer: 'badge-gray' };
const rolIcon = { admin: ShieldCheck, operador: Shield, viewer: Eye };

export default function Usuarios() {
  const { isAdmin } = useAuth();
  const [usuarios, setUsuarios] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [form, setForm] = useState({ rol: 'operador' });

  const load = () => api.getUsuarios().then(setUsuarios).catch(console.error);
  useEffect(() => { load(); }, []);

  if (!isAdmin) return <div className="empty-state">Solo administradores pueden acceder a esta seccion</div>;

  const openNew = () => { setEditUser(null); setForm({ rol: 'operador' }); setShowModal(true); };
  const openEdit = (u) => { setEditUser(u); setForm({ nombre: u.nombre, email: u.email, rol: u.rol, activo: u.activo }); setShowModal(true); };

  const save = async (e) => {
    e.preventDefault();
    try {
      if (editUser) {
        await api.updateUsuario(editUser.id, form);
      } else {
        await api.createUsuario(form);
      }
      setShowModal(false);
      load();
    } catch (err) { alert(err.message); }
  };

  const remove = async (id) => {
    if (!confirm('Eliminar este usuario?')) return;
    try {
      await api.deleteUsuario(id);
      load();
    } catch (err) { alert(err.message); }
  };

  return (
    <div>
      <div className="page-header">
        <h2>Gestion de Usuarios</h2>
        <button className="btn btn-primary" onClick={openNew}><Plus size={16} /> Nuevo Usuario</button>
      </div>
      <div className="card">
        <div className="table-container">
          <table>
            <thead><tr><th>Usuario</th><th>Nombre</th><th>Email</th><th>Rol</th><th>Estado</th><th>Creado</th><th></th></tr></thead>
            <tbody>
              {usuarios.map(u => {
                const RolIcon = rolIcon[u.rol] || Eye;
                return (
                  <tr key={u.id}>
                    <td><strong>{u.username}</strong></td>
                    <td>{u.nombre}</td>
                    <td>{u.email || '-'}</td>
                    <td><span className={`badge ${rolBadge[u.rol]}`}><RolIcon size={12} style={{ marginRight: 4 }} />{u.rol}</span></td>
                    <td><span className={`badge ${u.activo ? 'badge-green' : 'badge-red'}`}>{u.activo ? 'Activo' : 'Inactivo'}</span></td>
                    <td>{formatDate(u.created_at?.split('T')[0] || u.created_at?.split(' ')[0])}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="btn-icon" onClick={() => openEdit(u)}><Edit size={16} /></button>
                        <button className="btn-icon" onClick={() => remove(u.id)}><Trash2 size={16} color="#dc2626" /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h3>{editUser ? 'Editar Usuario' : 'Nuevo Usuario'}</h3><button className="btn-icon" onClick={() => setShowModal(false)}>&times;</button></div>
            <form onSubmit={save}>
              {!editUser && (
                <div className="form-row">
                  <div className="form-group">
                    <label>Username *</label>
                    <input required value={form.username || ''} onChange={e => setForm({ ...form, username: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label>Password *</label>
                    <input type="password" required minLength={6} value={form.password || ''} onChange={e => setForm({ ...form, password: e.target.value })} />
                  </div>
                </div>
              )}
              <div className="form-row">
                <div className="form-group">
                  <label>Nombre *</label>
                  <input required value={form.nombre || ''} onChange={e => setForm({ ...form, nombre: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Email</label>
                  <input type="email" value={form.email || ''} onChange={e => setForm({ ...form, email: e.target.value })} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Rol</label>
                  <select value={form.rol} onChange={e => setForm({ ...form, rol: e.target.value })}>
                    <option value="admin">Administrador</option>
                    <option value="operador">Operador</option>
                    <option value="viewer">Solo Lectura</option>
                  </select>
                </div>
                {editUser && (
                  <div className="form-group">
                    <label>Estado</label>
                    <select value={form.activo ? '1' : '0'} onChange={e => setForm({ ...form, activo: e.target.value === '1' })}>
                      <option value="1">Activo</option>
                      <option value="0">Inactivo</option>
                    </select>
                  </div>
                )}
              </div>
              {editUser && (
                <div className="form-group">
                  <label>Nueva Password (dejar vacio para no cambiar)</label>
                  <input type="password" minLength={6} value={form.password || ''} onChange={e => setForm({ ...form, password: e.target.value })} />
                </div>
              )}
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary">{editUser ? 'Guardar' : 'Crear'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
