/*
  Botón base. variante: 'primario' | 'secundario' | 'peligro'. tamano: 'sm' | 'lg'.
  Con cargando=true se deshabilita y muestra el spinner, para evitar dobles envíos.
*/
const clases = { primario: 'btn-primary', secundario: 'btn-secondary', peligro: 'btn-danger' };

export default function Boton({ variante = 'secundario', tamano, cargando = false, icono: Icono, children, className = '', disabled, type = 'button', ...resto }) {
  return (
    <button
      type={type}
      className={`btn ${clases[variante] || ''} ${tamano ? `btn-${tamano}` : ''} ${className}`.trim()}
      disabled={disabled || cargando}
      aria-busy={cargando || undefined}
      {...resto}
    >
      {cargando
        ? <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} aria-hidden="true" />
        : Icono && <Icono size={16} aria-hidden="true" />}
      {children}
    </button>
  );
}
