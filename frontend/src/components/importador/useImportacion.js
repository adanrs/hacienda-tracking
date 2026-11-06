import { useCallback, useRef, useState } from 'react';
import { api } from '../../services/api';
import { aviso } from '../ui/avisos';

/*
  Estado de una importación: guarda la última entrada (archivo o texto pegado) y sus opciones
  para poder volver a planificar al cambiar una opción y para aplicar exactamente lo que se vio.
  Si al aplicar el servidor responde 409 (la base cambió desde la vista previa), se reemplaza la
  vista previa por la nueva y se avisa: nunca se aplica algo distinto de lo revisado.
*/
export default function useImportacion(formato) {
  const [plan, setPlan] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [aplicando, setAplicando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const entradaRef = useRef(null);

  const planificar = useCallback(async (entrada, opciones = {}) => {
    entradaRef.current = { ...entrada, opciones };
    setCargando(true);
    setResultado(null);
    try {
      const p = await api.planificarImportacion(formato, { ...entrada, opciones });
      setPlan(p);
      return p;
    } catch (err) {
      setPlan(null);
      aviso.error(err.message, { titulo: 'No se pudo leer' });
      return null;
    } finally {
      setCargando(false);
    }
  }, [formato]);

  const replanificar = useCallback((opciones) => {
    if (!entradaRef.current) return null;
    const { opciones: previas, ...entrada } = entradaRef.current;
    return planificar(entrada, { ...previas, ...opciones });
  }, [planificar]);

  const aplicar = useCallback(async () => {
    if (!plan || !entradaRef.current) return null;
    setAplicando(true);
    try {
      const r = await api.aplicarImportacion(formato, { ...entradaRef.current, huella: plan.huella });
      setResultado(r);
      setPlan(null);
      return r;
    } catch (err) {
      if (err.status === 409 && err.datos?.plan) {
        setPlan(err.datos.plan);
        aviso.error('Los datos cambiaron desde la vista previa. Revise de nuevo y vuelva a aplicar.');
      } else {
        aviso.error(err.message, { titulo: 'No se aplicó la importación' });
      }
      return null;
    } finally {
      setAplicando(false);
    }
  }, [formato, plan]);

  const limpiar = useCallback(() => { setPlan(null); setResultado(null); entradaRef.current = null; }, []);

  return { plan, cargando, aplicando, resultado, planificar, replanificar, aplicar, limpiar, opciones: entradaRef.current?.opciones || {} };
}
