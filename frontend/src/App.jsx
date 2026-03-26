import { Routes, Route, NavLink } from 'react-router-dom';
import { LayoutDashboard, Bug as Cow, Weight, Heart, ArrowRightLeft, Baby, MapPin } from 'lucide-react';
import Dashboard from './pages/Dashboard';
import Animales from './pages/Animales';
import AnimalDetalle from './pages/AnimalDetalle';
import Pesajes from './pages/Pesajes';
import Salud from './pages/Salud';
import Movimientos from './pages/Movimientos';
import Reproduccion from './pages/Reproduccion';
import Potreros from './pages/Potreros';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/animales', icon: Cow, label: 'Animales' },
  { to: '/pesajes', icon: Weight, label: 'Pesajes' },
  { to: '/salud', icon: Heart, label: 'Salud' },
  { to: '/movimientos', icon: ArrowRightLeft, label: 'Movimientos' },
  { to: '/reproduccion', icon: Baby, label: 'Reproduccion' },
  { to: '/potreros', icon: MapPin, label: 'Potreros' },
];

export default function App() {
  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-header">
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
        </nav>
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
        </Routes>
      </main>
    </div>
  );
}
