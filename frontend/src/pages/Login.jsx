import { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../components/AuthContext';
import { Lock, User } from 'lucide-react';

export default function Login() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (user) return <Navigate to="/" />;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(form.username, form.password);
      navigate('/');
    } catch (err) {
      setError(err.message || 'No se pudo iniciar sesión');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(160deg, var(--nav-bg) 0%, #24364f 100%)', padding: 16
    }}>
      <div style={{
        background: '#fff', borderRadius: 16, padding: 40, width: '100%', maxWidth: 400,
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
      }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>&#x1F404;</div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text)' }}>Hacienda Tempisque</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: 4 }}>Sistema de trazabilidad de ganado</p>
        </div>

        {error && (
          <div role="alert" style={{
            background: 'var(--error-suave)', color: 'var(--error-fuerte)', padding: '10px 14px', borderRadius: 8,
            fontSize: '0.85rem', marginBottom: 16, textAlign: 'center'
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="login-usuario">Usuario</label>
            <div style={{ position: 'relative' }}>
              <User size={16} style={{ position: 'absolute', left: 10, top: 10, color: '#9ca3af' }} />
              <input
                value={form.username}
                onChange={e => setForm({ ...form, username: e.target.value })}
                id="login-usuario"
                autoComplete="username"
                placeholder="Ingrese su usuario"
                required
                autoFocus
                style={{ paddingLeft: 34 }}
              />
            </div>
          </div>
          <div className="form-group">
            <label htmlFor="login-clave">Contraseña</label>
            <div style={{ position: 'relative' }}>
              <Lock size={16} style={{ position: 'absolute', left: 10, top: 10, color: '#9ca3af' }} />
              <input
                type="password"
                value={form.password}
                onChange={e => setForm({ ...form, password: e.target.value })}
                id="login-clave"
                autoComplete="current-password"
                placeholder="Ingrese su contraseña"
                required
                style={{ paddingLeft: 34 }}
              />
            </div>
          </div>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading}
            style={{ width: '100%', padding: '12px', justifyContent: 'center', fontSize: '1rem', marginTop: 8 }}
          >
            {loading ? 'Ingresando…' : 'Iniciar sesión'}
          </button>
        </form>
      </div>
    </div>
  );
}
