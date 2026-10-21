import { useCallback, useEffect, useRef, useState } from 'react';
import { ClipboardList, List } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../components/AuthContext';
import { confirmar } from '../components/ui/confirmar';
import EditorSolicitud from './solicitud-deshuese/EditorSolicitud';
import ListaSolicitudes from './solicitud-deshuese/ListaSolicitudes';
import { hoyIso } from './reporte-produccion/util';

/*
  Solicitud de deshuese: después de cada sacrificio se le dice a la planta, canal por canal,
  qué cortes deshuesar y en cuántas medias canales (0, 1 o 2). Reemplaza la hoja de cálculo
  que se armaba aparte; el Excel que se descarga conserva el mismo acomodo.
  Pestaña «Solicitud»: se elige la fecha de sacrificio y se edita la matriz corte × canal.
  Pestaña «Todas las solicitudes»: lista con su estado (borrador, enviada, deshuesada).
*/
const PESTANAS = [
  { id: 'solicitud', texto: 'Solicitud', Icono: ClipboardList },
  { id: 'lista', texto: 'Todas las solicitudes', Icono: List },
];

export default function SolicitudDeshuese() {
  const { canEdit } = useAuth();
  const [tab, setTab] = useState('solicitud');
  // La fecha vive en la URL (?fecha=AAAA-MM-DD): se puede compartir el enlace de una solicitud
  // y el botón Atrás del navegador vuelve a la fecha anterior.
  const [params, setParams] = useSearchParams();
  const fechaUrl = params.get('fecha');
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(fechaUrl || '') ? fechaUrl : hoyIso();
  const setFechaCruda = useCallback((f) => setParams({ fecha: f }), [setParams]);
  const [version, setVersion] = useState(0); // la lista se recarga al guardar o cambiar de estado
  const sucio = useRef(false);

  // Hay cambios sin guardar: se pregunta antes de cambiar de fecha o de pestaña, y el navegador
  // avisa si se cierra la pestaña (una matriz de 30 cortes por varias canales cuesta rehacerla).
  useEffect(() => {
    const antesDeSalir = (e) => { if (sucio.current) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', antesDeSalir);
    return () => window.removeEventListener('beforeunload', antesDeSalir);
  }, []);

  const puedeDescartar = useCallback(async () => {
    if (!sucio.current) return true;
    const ok = await confirmar({
      titulo: '¿Descartar los cambios sin guardar?',
      mensaje: 'La solicitud tiene cambios que no se han guardado.',
      textoConfirmar: 'Descartar',
      peligro: true,
    });
    if (ok) sucio.current = false;
    return ok;
  }, []);

  const setFecha = useCallback(async (f) => {
    if (!f || f === fecha) return;
    if (await puedeDescartar()) setFechaCruda(f);
  }, [fecha, puedeDescartar, setFechaCruda]);

  const cambiarTab = async (id) => {
    if (id === tab) return;
    if (await puedeDescartar()) setTab(id);
  };

  const abrir = async (f) => {
    if (!(await puedeDescartar())) return;
    setFechaCruda(f);
    setTab('solicitud');
  };

  return (
    <div>
      <div className="page-header">
        <h2>Solicitud de deshuese</h2>
      </div>

      <div className="tabs" role="tablist" aria-label="Solicitud de deshuese">
        {PESTANAS.map(({ id, texto, Icono }) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`panel-${id}`}
            className={`tab ${tab === id ? 'active' : ''}`}
            onClick={() => cambiarTab(id)}
          >
            <Icono size={16} style={{ marginRight: 6 }} aria-hidden="true" />{texto}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'solicitud' && (
          <EditorSolicitud
            fecha={fecha}
            setFecha={setFecha}
            canEdit={canEdit}
            onSucio={(v) => { sucio.current = v; }}
            onCambio={() => setVersion(v => v + 1)}
          />
        )}
        {tab === 'lista' && <ListaSolicitudes key={version} canEdit={canEdit} onAbrir={abrir} />}
      </div>
    </div>
  );
}
