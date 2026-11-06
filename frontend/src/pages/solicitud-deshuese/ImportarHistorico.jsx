import { useState } from 'react';
import { CheckCircle2, Upload } from 'lucide-react';
import Boton from '../../components/ui/Boton';
import { confirmar } from '../../components/ui/confirmar';
import { aviso } from '../../components/ui/avisos';
import VistaPrevia from '../../components/importador/VistaPrevia';
import ResumenPlan from '../../components/importador/ResumenPlan';
import useImportacion from '../../components/importador/useImportacion';

/*
  Importar solicitudes HISTÓRICAS desde el libro Excel de la planta («Solicitud_de_Deshuese_y_
  Porcionado.xlsx», una hoja «Deshuese ddmmaa» por día). Cada hoja es una fila de la vista previa;
  solo se importan las canales que tienen sacrificio registrado en la app. Si el nombre de la hoja
  admite dos fechas, se pregunta cuál. Las importadas quedan como «deshuesada».
*/
const fecha = (iso) => (iso ? iso.split('-').reverse().join('/') : '—');

export default function ImportarHistorico({ canEdit, onAplicado }) {
  const [archivo, setArchivo] = useState(null);
  const [fechas, setFechas] = useState({});
  const imp = useImportacion('solicitud-deshuese-excel');
  const { plan } = imp;

  const elegir = (e) => {
    const a = e.target.files?.[0]; e.target.value = '';
    if (!a) return;
    if (a.size > 40 * 1024 * 1024) { aviso.error('El libro pesa más de 40 MB'); return; }
    setArchivo(a); setFechas({});
    imp.planificar({ archivos: [a] }, {});
  };
  const elegirFecha = (hoja, f) => {
    const n = { ...fechas, [hoja]: f.split('-').reverse().join('/') };
    setFechas(n);
    imp.replanificar({ fechas: n });
  };
  const aplicar = async () => {
    if (!(await confirmar({ titulo: '¿Importar las solicitudes?', mensaje: `Se crean ${plan.resumen.nuevos} solicitud(es) históricas en estado «deshuesada».`, textoConfirmar: 'Importar' }))) return;
    const r = await imp.aplicar();
    if (r) { aviso.ok(`Solicitudes importadas: ${r.resultado.resumen.solicitudes}`); setArchivo(null); onAplicado?.(); }
  };

  const COLUMNAS = [
    { titulo: 'Hoja', valor: f => <strong>{f.hoja || f.clave}</strong> },
    {
      titulo: 'Fecha de sacrificio', valor: f => (f.fechas_posibles?.length > 1 && canEdit ? (
        <select aria-label={`Fecha de la hoja ${f.hoja}`} value={f.fecha || ''} onChange={e => elegirFecha(f.hoja, e.target.value)}>
          <option value="">Elija…</option>
          {f.fechas_posibles.map(x => <option key={x} value={x}>{fecha(x)}</option>)}
        </select>
      ) : fecha(f.fecha)),
    },
    { titulo: 'Canales', num: true, valor: f => (f.total_canales == null ? '—' : `${f.canales_ligadas ?? 0} de ${f.total_canales}`) },
    { titulo: 'Cortes', num: true, valor: f => f.total_cortes ?? '—' },
  ];

  return (
    <div className="card">
      <h3>Importar solicitudes históricas (Excel de la planta)</h3>
      <p className="rp-tenue">Suba el libro «Solicitud de Deshuese y Porcionado». Solo se importan las canales con sacrificio registrado; los cortes sin código quedan «pendientes de codificar» (99).</p>
      <label className="btn btn-secondary" style={{ cursor: canEdit ? 'pointer' : 'not-allowed' }}>
        <Upload size={16} aria-hidden="true" /> {archivo ? archivo.name : 'Elegir el libro .xlsx'}
        <input type="file" accept=".xlsx" hidden disabled={!canEdit || imp.cargando} onChange={elegir} />
      </label>
      {imp.cargando && <p className="rp-tenue">Leyendo el libro… (puede tardar con libros grandes)</p>}
      {plan && (
        <div>
          <ResumenPlan resumen={plan.resumen} />
          <VistaPrevia filas={plan.filas} columnas={COLUMNAS} />
          <div className="modal-actions">
            <Boton variante="primario" icono={CheckCircle2} cargando={imp.aplicando} disabled={!canEdit || !plan.resumen.nuevos} onClick={aplicar}>Importar {plan.resumen.nuevos} solicitud(es)</Boton>
          </div>
        </div>
      )}
    </div>
  );
}
