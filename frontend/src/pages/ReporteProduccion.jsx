import { useCallback, useEffect, useState } from 'react';
import { FileSpreadsheet, ScanLine, Upload, Tag } from 'lucide-react';
import { api } from '../services/api';
import { aviso } from '../components/ui/avisos';
import { useAuth } from '../components/AuthContext';
import VistaReporte from './reporte-produccion/VistaReporte';
import CargaCiisa from './reporte-produccion/CargaCiisa';
import EscaneoDeshuese from './reporte-produccion/EscaneoDeshuese';
import TablaAretes from './reporte-produccion/TablaAretes';
import { hoyIso } from './reporte-produccion/util';

/*
  Reporte Diario de Producción (formato CIISA) con dos fuentes y su conciliación:
    - lo que se escanea en la app (etiquetas de deshuese: caja o primal), y
    - lo que declara CIISA en su reporte (Excel/CSV, pegado o capturado a mano),
  más la tabla posición → arete del día. La pestaña «Reporte» las cruza por lote CC y artículo.
*/
const PESTANAS = [
  { id: 'reporte', texto: 'Reporte', Icono: FileSpreadsheet },
  { id: 'escanear', texto: 'Escanear etiquetas', Icono: ScanLine },
  { id: 'cargar', texto: 'Cargar reporte CIISA', Icono: Upload },
  { id: 'aretes', texto: 'Aretes por posición', Icono: Tag },
];

export default function ReporteProduccion() {
  const { canEdit } = useAuth();
  const [tab, setTab] = useState('reporte');
  const [fecha, setFechaCruda] = useState(hoyIso());
  const [dias, setDias] = useState([]);
  const [edicion, setEdicion] = useState(null);
  const [version, setVersion] = useState(0); // fuerza recargar el reporte al volver de una carga

  const setFecha = (f) => { if (f) setFechaCruda(f); };

  const cargarDias = useCallback((elegirUltimo = false) => {
    api.getReporteProduccionDias()
      .then(ds => {
        setDias(ds);
        // Al abrir: si hoy no hay datos, se muestra el último día con datos en vez de una pantalla vacía.
        if (elegirUltimo && ds.length && !ds.some(d => d.fecha === hoyIso())) setFechaCruda(ds[0].fecha);
      })
      .catch(() => setDias([]));
  }, []);
  useEffect(() => { cargarDias(true); }, [cargarDias]);

  const corregir = async (id) => {
    try {
      const r = await api.getReporteCiisa(id);
      // Con el id, guardar ACTUALIZA ese reporte aunque se corrija la fecha o el lote CC (no crea otro).
      setEdicion({ clave: Date.now(), id: r.id, datos: { encabezado: r.encabezado, lineas: r.lineas }, origen: r.origen, archivo_nombre: r.archivo_nombre });
      setTab('cargar');
    } catch (e) { aviso.error(e.message); }
  };

  const alGuardar = (f, irAlReporte = true) => {
    setFecha(f);
    cargarDias();
    setVersion(v => v + 1);
    if (irAlReporte) setTab('reporte');
  };

  const visibles = PESTANAS.filter(p => canEdit || p.id !== 'cargar');

  return (
    <div>
      <div className="page-header">
        <h2>Reporte de producción</h2>
      </div>

      <div className="tabs" role="tablist" aria-label="Reporte de producción">
        {visibles.map(({ id, texto, Icono }) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`panel-${id}`}
            className={`tab ${tab === id ? 'active' : ''}`}
            onClick={() => setTab(id)}
          >
            <Icono size={16} style={{ marginRight: 6 }} aria-hidden="true" />{texto}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'reporte' && (
          <VistaReporte key={version} fecha={fecha} setFecha={setFecha} dias={dias} canEdit={canEdit} onCorregir={corregir} irA={setTab} />
        )}
        {tab === 'escanear' && <EscaneoDeshuese fecha={fecha} setFecha={setFecha} canEdit={canEdit} />}
        {tab === 'cargar' && canEdit && <CargaCiisa fecha={fecha} edicion={edicion} setEdicion={setEdicion} onGuardado={alGuardar} />}
        {tab === 'aretes' && <TablaAretes fecha={fecha} setFecha={setFecha} canEdit={canEdit} />}
      </div>
    </div>
  );
}
