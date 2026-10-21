import { useEffect, useRef, useState } from 'react';
import { Routes, Route, NavLink, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { LayoutDashboard, Beef, Weight, Heart, ArrowRightLeft, Baby, MapPin, Users, LogOut, User, Truck, Warehouse, Scissors, Slice, Package, Snowflake, Clock, Boxes, FileOutput, FileInput, RotateCcw, Barcode, Utensils, BookOpen, Menu, X, FileSpreadsheet, ClipboardList } from 'lucide-react';
import { AuthProvider, useAuth } from './components/AuthContext';
import { CowWalking } from './components/CowIcon';
import { Avisos } from './components/ui/avisos';
import { DialogoConfirmacion } from './components/ui/confirmar';
import useEtiquetasTablas from './components/ui/useEtiquetasTablas';
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
import CatalogoCortes from './pages/CatalogoCortes';
import ReporteProduccion from './pages/ReporteProduccion';
import SolicitudDeshuese from './pages/SolicitudDeshuese';

// Menú ordenado según el recorrido del producto: Finca → Planta → Bodega y despacho.
const grupos = [
  {
    titulo: 'Inicio',
    items: [{ to: '/', icon: LayoutDashboard, label: 'Resumen general' }],
  },
  {
    titulo: 'Finca',
    items: [
      { to: '/animales', icon: Beef, label: 'Animales' },
      { to: '/pesajes', icon: Weight, label: 'Pesajes' },
      { to: '/salud', icon: Heart, label: 'Salud' },
      { to: '/movimientos', icon: ArrowRightLeft, label: 'Movimientos' },
      { to: '/reproduccion', icon: Baby, label: 'Reproducción' },
      { to: '/potreros', icon: MapPin, label: 'Potreros' },
    ],
  },
  {
    titulo: 'Planta',
    items: [
      { to: '/transporte', icon: Truck, label: 'Transporte' },
      { to: '/sacrificio', icon: Warehouse, label: 'Sacrificio' },
      { to: '/solicitud-deshuese', icon: ClipboardList, label: 'Solicitud de deshuese' },
      { to: '/deshuese', icon: Scissors, label: 'Deshuese' },
      { to: '/reporte-produccion', icon: FileSpreadsheet, label: 'Reporte de producción' },
      { to: '/cortes', icon: Slice, label: 'Cortes por animal' },
      { to: '/custodia', icon: Package, label: 'Custodia' },
      { to: '/maduracion', icon: Clock, label: 'Maduración' },
      { to: '/porcionado', icon: Boxes, label: 'Porcionado' },
      { to: '/paqueteria', icon: Utensils, label: 'Paquetería' },
      { to: '/cajas', icon: Barcode, label: 'Cajas y etiquetas' },
    ],
  },
  {
    titulo: 'Bodega y despacho',
    items: [
      { to: '/bodegas', icon: Snowflake, label: 'Bodegas' },
      { to: '/ordenes-entrada', icon: FileInput, label: 'Órdenes de entrada' },
      { to: '/ordenes-salida', icon: FileOutput, label: 'Órdenes de salida' },
      { to: '/devoluciones', icon: RotateCcw, label: 'Devoluciones' },
    ],
  },
  {
    titulo: 'Configuración',
    items: [
      { to: '/catalogo-cortes', icon: BookOpen, label: 'Catálogo de cortes' },
      { to: '/usuarios', icon: Users, label: 'Usuarios', soloAdmin: true },
    ],
  },
];

const rolLegible = { admin: 'Administrador', operador: 'Operador', viewer: 'Solo lectura' };

function ubicacionActual(pathname) {
  for (const g of grupos) {
    for (const it of g.items) {
      const coincide = it.to === '/' ? pathname === '/' : pathname === it.to || pathname.startsWith(`${it.to}/`);
      if (coincide) return { etapa: g.titulo, pagina: it.label };
    }
  }
  return { etapa: '', pagina: '' };
}

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return (
    <div className="estado" role="status" style={{ minHeight: '100vh', justifyContent: 'center' }}>
      <CowWalking size={64} />
      <p>Cargando…</p>
    </div>
  );
  if (!user) return <Navigate to="/login" />;
  return children;
}

function AppLayout() {
  const { user, logout, isAdmin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [navAbierta, setNavAbierta] = useState(false);
  const refMain = useRef(null);
  const refNav = useRef(null);
  const refBotonMenu = useRef(null);
  useEtiquetasTablas(refMain);

  const { etapa, pagina } = ubicacionActual(location.pathname);

  // Al cambiar de pantalla: cerrar el menú y actualizar el título de la pestaña.
  useEffect(() => {
    setNavAbierta(false);
    document.title = pagina ? `${pagina} · Trazabilidad` : 'Trazabilidad · Hacienda Tempisque';
  }, [location.pathname, pagina]);

  // Menú abierto en tablet/celular: foco al primer enlace y Escape para cerrar.
  useEffect(() => {
    if (!navAbierta) return undefined;
    refNav.current?.querySelector('a')?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') { setNavAbierta(false); refBotonMenu.current?.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [navAbierta]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className={`layout ${navAbierta ? 'nav-abierta' : ''}`}>
      <a href="#contenido" className="salto-contenido">Saltar al contenido</a>

      <header className="topbar">
        <button
          ref={refBotonMenu}
          type="button"
          className="btn-menu"
          aria-expanded={navAbierta}
          aria-controls="menu-principal"
          onClick={() => setNavAbierta(v => !v)}
        >
          {navAbierta ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
          <span>Menú</span>
        </button>
        <div className="topbar-ubicacion">
          {etapa && <div className="topbar-etapa">{etapa}</div>}
          <div className="topbar-pagina">{pagina || 'Trazabilidad'}</div>
        </div>
      </header>

      <div className="nav-fondo" onClick={() => setNavAbierta(false)} aria-hidden="true" />

      <aside className="sidebar" id="menu-principal">
        <div className="sidebar-header">
          <Beef size={28} className="marca-icono" aria-hidden="true" />
          <div>
            <h1>Hacienda Tempisque</h1>
            <p>Trazabilidad de ganado</p>
          </div>
        </div>
        <nav aria-label="Menú principal" ref={refNav}>
          {grupos.map(g => {
            const visibles = g.items.filter(it => !it.soloAdmin || isAdmin);
            if (!visibles.length) return null;
            const contieneActivo = g.titulo === etapa;
            const idTitulo = `grupo-${g.titulo.replace(/\s+/g, '-').toLowerCase()}`;
            return (
              <div key={g.titulo} className={`nav-grupo ${contieneActivo ? 'contiene-activo' : ''}`} role="group" aria-labelledby={idTitulo}>
                <div className="nav-grupo-titulo" id={idTitulo}>{g.titulo}</div>
                <ul>
                  {visibles.map(({ to, icon: Icon, label }) => (
                    <li key={to}>
                      <NavLink to={to} end={to === '/'} className={({ isActive }) => isActive ? 'active' : ''}>
                        <Icon size={20} aria-hidden="true" />
                        <span>{label}</span>
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <div className="usuario-actual">
            <div className="usuario-avatar"><User size={16} color="#fff" aria-hidden="true" /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="usuario-nombre">{user?.nombre}</div>
              <div className="usuario-rol">{rolLegible[user?.rol] || user?.rol}</div>
            </div>
          </div>
          <button type="button" className="btn-salir" onClick={handleLogout}>
            <LogOut size={16} aria-hidden="true" /> Cerrar sesión
          </button>
        </div>
      </aside>

      <main className="main-content" id="contenido" tabIndex={-1} ref={refMain}>
        {etapa && etapa !== 'Inicio' && <p className="migas">{etapa} › {pagina}</p>}
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
          <Route path="/solicitud-deshuese" element={<SolicitudDeshuese />} />
          <Route path="/deshuese" element={<Deshuese />} />
          <Route path="/reporte-produccion" element={<ReporteProduccion />} />
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
          <Route path="/catalogo-cortes" element={<CatalogoCortes />} />
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
      <Avisos />
      <DialogoConfirmacion />
    </AuthProvider>
  );
}
