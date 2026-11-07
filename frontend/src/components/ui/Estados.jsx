import { useCallback, useState } from 'react';
import { Inbox, WifiOff, RefreshCw } from 'lucide-react';

/*
  Estado de la carga principal de una pantalla, para alimentar <FilaEstado>.
    const [carga, seguir] = useEstadoCarga();
    const load = () => seguir(api.getPesajes().then(setPesajes));
  «cargando» solo es true hasta la primera respuesta: al recargar después de guardar, la tabla
  sigue a la vista en vez de parpadear. Si la carga falla, el error queda en la tabla (con
  «Reintentar») en vez de un aviso que se va y una tabla que dice «sin datos».
*/
export function useEstadoCarga() {
  const [estado, setEstado] = useState({ cargando: true, error: null });
  const seguir = useCallback((promesa) => promesa
    .then(r => { setEstado({ cargando: false, error: null }); return r; })
    .catch(err => { setEstado({ cargando: false, error: err?.message || 'Error de conexión' }); }), []);
  return [estado, seguir];
}

/* Indicador de carga accesible (anuncia «Cargando…» a lectores de pantalla). */
export function Cargando({ texto = 'Cargando…' }) {
  return (
    <div className="estado" role="status" aria-live="polite">
      <div className="spinner" aria-hidden="true" />
      <div>{texto}</div>
    </div>
  );
}

/* Estado vacío con texto útil y, si aplica, la acción siguiente. */
export function EstadoVacio({ icono: Icono = Inbox, titulo, texto, accion }) {
  return (
    <div className="estado">
      <Icono size={36} className="estado-icono" aria-hidden="true" />
      <div className="estado-titulo">{titulo}</div>
      {texto && <div className="estado-texto">{texto}</div>}
      {accion}
    </div>
  );
}

/* Estado de error de red / servidor con botón «Reintentar». */
export function EstadoError({ titulo = 'No se pudieron cargar los datos', mensaje, onReintentar }) {
  return (
    <div className="estado error" role="alert">
      <WifiOff size={36} className="estado-icono" aria-hidden="true" />
      <div className="estado-titulo">{titulo}</div>
      <div className="estado-texto">{mensaje || 'Revise la conexión a internet o a la red de la planta e intente de nuevo.'}</div>
      {onReintentar && (
        <button type="button" className="btn btn-secondary" onClick={onReintentar}>
          <RefreshCw size={16} aria-hidden="true" /> Reintentar
        </button>
      )}
    </div>
  );
}

/*
  Fila única para el <tbody> de una tabla: muestra cargando, error o vacío.
  Devuelve null cuando hay datos.
    <FilaEstado columnas={7} cargando={cargando} error={error} vacio={cajas.length === 0}
                onReintentar={load} tituloVacio="No hay cajas" textoVacio="…" />
*/
export function FilaEstado({ columnas, cargando, error, vacio, onReintentar, tituloVacio, textoVacio, accionVacio }) {
  let contenido = null;
  if (cargando) contenido = <Cargando />;
  else if (error) contenido = <EstadoError mensaje={error} onReintentar={onReintentar} />;
  else if (vacio) contenido = <EstadoVacio titulo={tituloVacio} texto={textoVacio} accion={accionVacio} />;
  if (!contenido) return null;
  return (
    <tr>
      <td colSpan={columnas} className="celda-estado">{contenido}</td>
    </tr>
  );
}
