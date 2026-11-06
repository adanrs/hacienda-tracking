import { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../components/AuthContext';
import { Beef, CircleAlert, Lock, User } from 'lucide-react';

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
    <main className="login-pagina">
      <div className="login-tarjeta">
        <div className="login-marca">
          <Beef size={40} strokeWidth={1.75} aria-hidden="true" />
          <div>
            <h1>Hacienda Tempisque</h1>
            <p>Sistema de trazabilidad de ganado</p>
          </div>
        </div>

        {error && (
          <div role="alert" className="login-error">
            <CircleAlert size={18} aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="login-usuario">Usuario</label>
            <div className="campo-con-icono">
              <User size={18} aria-hidden="true" />
              <input
                value={form.username}
                onChange={e => setForm({ ...form, username: e.target.value })}
                id="login-usuario"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="Ingrese su usuario"
                required
                autoFocus
              />
            </div>
          </div>
          <div className="form-group">
            <label htmlFor="login-clave">Contraseña</label>
            <div className="campo-con-icono">
              <Lock size={18} aria-hidden="true" />
              <input
                type="password"
                value={form.password}
                onChange={e => setForm({ ...form, password: e.target.value })}
                id="login-clave"
                autoComplete="current-password"
                placeholder="Ingrese su contraseña"
                required
              />
            </div>
          </div>
          <button
            type="submit"
            className="btn btn-primary login-enviar"
            disabled={loading}
            aria-busy={loading || undefined}
          >
            {loading ? 'Ingresando…' : 'Iniciar sesión'}
          </button>
        </form>
      </div>
    </main>
  );
}
