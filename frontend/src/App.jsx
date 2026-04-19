import { Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Bug as Cow, Weight, Heart, ArrowRightLeft, Baby, MapPin, Users, LogOut, User, Truck, Warehouse, Scissors, Package, Snowflake, Clock, Boxes, FileOutput, FileInput, RotateCcw, Barcode, Utensils } from 'lucide-react';
import { AuthProvider, useAuth } from './components/AuthContext';
import { CowWalking } from './components/CowIcon';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Animales from './pages/Animales';
import AnimalDetalle from './pages/AnimalDetalle';
import Pesajes from './pages/Pesajes';
import Salud from './pages/Salud';
import Movimientos from './pages/Movimientos';
import Reproduccion from './pages/Reproduccion';
import Potreros from './pages/Potreros';
import Usuarios from './pages/Usuarios';
import Transporte from './pages/Transporte';
import Sacrificio from './pages/Sacrificio';
import Cortes from './pages/Cortes';
import Deshuese from './pages/Deshuese';
import Bodegas from './pages/Bodegas';
import Custodia from './pages/Custodia';
import Maduracion from './pages/Maduracion';
import Porcionado from './pages/Porcionado';
import Cajas from './pages/Cajas';
import OrdenesSalida from './pages/OrdenesSalida';
import OrdenesEntrada from './pages/OrdenesEntrada';
import Devoluciones from './pages/Devoluciones';
import Paqueteria from './pages/Paqueteria';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/animales', icon: Cow, label: 'Animales' },
  { to: '/pesajes', icon: Weight, label: 'Pesajes' },
  { to: '/salud', icon: Heart, label: 'Salud' },
  { to: '/movimientos', icon: ArrowRightLeft, label: 'Movimientos' },
  { to: '/reproduccion', icon: Baby, label: 'Reproduccion' },
  { to: '/potreros', icon: MapPin, label: 'Potreros' },
  { to: '/transporte', icon: Truck, label: 'Transporte' },
  { to: '/sacrificio', icon: Warehouse, label: 'Sacrificio' },
  { to: '/deshuese', icon: Scissors, label: 'Deshuese' },
  { to: '/custodia', icon: Package, label: 'Custodia' },
  { to: '/maduracion', icon: Clock, label: 'Maduracion' },
  { to: '/porcionado', icon: Boxes, label: 'Porcionado' },
  { to: '/paqueteria', icon: Utensils, label: 'Paqueteria' },
  { to: '/cortes', icon: Scissors, label: 'Cortes' },
  { to: '/cajas', icon: Barcode, label: 'Cajas' },
  { to: '/ordenes-entrada', icon: FileInput, label: 'Ord. Entrada' },
  { to: '/ordenes-salida', icon: FileOutput, label: 'Ord. Salida' },
  { to: '/devoluciones', icon: RotateCcw, label: 'Devoluciones' },
  { to: '/bodegas', icon: Snowflake, label: 'Bodegas' },
];

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', flexDirection: 'column', gap: 16 }}>
      <CowWalking size={64} />
      <p style={{ color: '#6b7280' }}>Cargando...</p>
    </div>
  );
  if (!user) return <Navigate to="/login" />;
  return children;
}

function AppLayout() {
  const { user, logout, isAdmin } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div style={{ fontSize: 32 }}>&#x1F404;</div>
          <h1>Hacienda Tempisque</h1>
          <p>Sistema de Trazabilidad</p>
        </div>
        <nav>
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => isActive ? 'active' : ''}>
              <Icon size={20} />
              <span>{label}</span>
            </NavLink>
          ))}
          {isAdmin && (
            <NavLink to="/usuarios" className={({ isActive }) => isActive ? 'active' : ''}>
              <Users size={20} />
              <span>Usuarios</span>
            </NavLink>
          )}
        </nav>
        <div className="sidebar-footer" style={{ padding: '12px 16px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <User size={16} color="#fff" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '0.82rem', color: '#fff', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.nombre}</div>
              <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.5)' }}>{user?.rol}</div>
            </div>
          </div>
          <button onClick={handleLogout} style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
            background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: 6, color: 'rgba(255,255,255,0.7)',
            cursor: 'pointer', fontSize: '0.82rem', transition: 'all 0.2s'
          }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(220,38,38,0.3)'; e.currentTarget.style.color = '#fff'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = 'rgba(255,255,255,0.7)'; }}
          >
            <LogOut size={16} /> Cerrar Sesion
          </button>
        </div>
      </aside>
      <main className="main-content">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/animales" element={<Animales />} />
          <Route path="/animales/:id" element={<AnimalDetalle />} />
          <Route path="/pesajes" element={<Pesajes />} />
          <Route path="/salud" element={<Salud />} />
          <Route path="/movimientos" element={<Movimientos />} />
          <Route path="/reproduccion" element={<Reproduccion />} />
          <Route path="/potreros" element={<Potreros />} />
          <Route path="/transporte" element={<Transporte />} />
          <Route path="/sacrificio" element={<Sacrificio />} />
          <Route path="/deshuese" element={<Deshuese />} />
          <Route path="/custodia" element={<Custodia />} />
          <Route path="/maduracion" element={<Maduracion />} />
          <Route path="/porcionado" element={<Porcionado />} />
          <Route path="/cortes" element={<Cortes />} />
          <Route path="/cajas" element={<Cajas />} />
          <Route path="/ordenes-salida" element={<OrdenesSalida />} />
          <Route path="/ordenes-entrada" element={<OrdenesEntrada />} />
          <Route path="/paqueteria" element={<Paqueteria />} />
          <Route path="/devoluciones" element={<Devoluciones />} />
          <Route path="/bodegas" element={<Bodegas />} />
          <Route path="/usuarios" element={<Usuarios />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/*" element={<ProtectedRoute><AppLayout /></ProtectedRoute>} />
      </Routes>
    </AuthProvider>
  );
}
