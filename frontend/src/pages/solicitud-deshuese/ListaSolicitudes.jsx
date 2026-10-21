import { useCallback, useEffect, useState } from 'react';
import { Download, FolderOpen } from 'lucide-react';
import { api } from '../../services/api';
import { aviso } from '../../components/ui/avisos';
import Boton from '../../components/ui/Boton';
import { FilaEstado } from '../../components/ui/Estados';
import { fechaCorta } from '../reporte-produccion/util';
import { ESTADO_SOLICITUD, nombreExcel } from './util';

/* Todas las solicitudes de deshuese, la más reciente primero, con su estado. */
export default function ListaSolicitudes({ onAbrir }) {
  const [filas, setFilas] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [descargando, setDescargando] = useState(null);

  const cargar = useCallback(() => {
    setCargando(true);
    setError(null);
    api.getSolicitudesDeshuese()
      .then(setFilas)
      .catch(e => setError(e.message))
      .finally(() => setCargando(false));
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const descargar = async (s) => {
    setDescargando(s.id);
    try {
      await api.descargarSolicitudDeshuese(s.id, nombreExcel(s));
    } catch (e) { aviso.error(e.message); } finally { setDescargando(null); }
  };

  return (
    <div className="card">
      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>N.º</th>
              <th>Fecha de sacrificio</th>
              <th className="num">Canales</th>
              <th>Estado</th>
              <th>Enviada</th>
              <th>Creada por</th>
              <th><span className="sr-only">Acciones</span></th>
            </tr>
          </thead>
          <tbody>
            <FilaEstado
              columnas={7}
              cargando={cargando}
              error={error}
              vacio={!filas.length}
              onReintentar={cargar}
              tituloVacio="Todavía no hay solicitudes de deshuese"
              textoVacio="En la pestaña «Solicitud» elija la fecha de sacrificio y guarde la primera."
            />
            {!cargando && !error && filas.map(s => {
              const est = ESTADO_SOLICITUD[s.estado] || { texto: s.estado, badge: 'badge-gray' };
              return (
                <tr key={s.id}>
                  <td className="numero">{s.numero}</td>
                  <td>{fechaCorta(s.fecha_sacrificio)}</td>
                  <td className="num">{s.canales}</td>
                  <td><span className={`badge ${est.badge}`}>{est.Icono && <est.Icono size={12} aria-hidden="true" />} {est.texto}</span></td>
                  <td>{s.enviada_en ? `${s.enviada_en}${s.enviada_a ? ` · ${s.enviada_a}` : ''}` : <span className="rp-tenue">—</span>}</td>
                  <td>{s.creado_por || <span className="rp-tenue">—</span>}</td>
                  <td>
                    <div className="rp-acciones">
                      <Boton tamano="sm" icono={FolderOpen} onClick={() => onAbrir(s.fecha_sacrificio)}>Abrir</Boton>
                      <Boton tamano="sm" icono={Download} cargando={descargando === s.id} onClick={() => descargar(s)}>Excel</Boton>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
