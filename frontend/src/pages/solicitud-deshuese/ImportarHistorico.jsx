import { useState } from 'react';
import { CheckCircle2, ListChecks, Upload } from 'lucide-react';
import Boton from '../../components/ui/Boton';
import { confirmar } from '../../components/ui/confirmar';
import { aviso } from '../../components/ui/avisos';
import VistaPrevia from '../../components/importador/VistaPrevia';
import ResumenPlan from '../../components/importador/ResumenPlan';
import useImportacion from '../../components/importador/useImportacion';
import LecturaFoto from '../../components/importador/LecturaFoto';

/*
  Importar solicitudes HISTÓRICAS desde el libro Excel de la planta («Solicitud_de_Deshuese_y_
  Porcionado.xlsx», una hoja «Deshuese ddmmaa» por día). Cada hoja es una fila de la vista previa;
  solo se importan las canales que tienen sacrificio registrado en la app. Si el nombre de la hoja
  admite dos fechas, se pregunta cuál. Las importadas quedan como «deshuesada».
  También por FOTO de la solicitud impresa (una por página): el texto vuelve a un cuadro editable
  («Deshuese ddmmaa», una línea por dato de las canales y una por corte, separadas por tabulador) y
  el backend lo vuelca a la misma hoja que el Excel (solicitudDeshueseExcel.hojaDesdeTexto). Si la
  foto no trae la fecha, se indica abajo.
*/
const fecha = (iso) => (iso ? iso.split('-').reverse().join('/') : '—');
const EJEMPLO = 'Deshuese 151026\nCanal #\tCanal # 1\tCanal # 2\nArete\t225MLE\t438MLF\nConsecutivo Mes Sacrificio\t5256\t5257\nCodigo\n22229\tCH-CHUCK RES\t2\t2';

export default function ImportarHistorico({ canEdit, onAplicado }) {
  const [archivo, setArchivo] = useState(null);
  const [fechas, setFechas] = useState({});
  const [texto, setTexto] = useState('');
  const [foto, setFoto] = useState(null); // { dudosas } si el texto salió de una foto
  const [fechaTexto, setFechaTexto] = useState('');
  const imp = useImportacion('solicitud-deshuese-excel');
  const { plan } = imp;

  const elegir = (e) => {
    const a = e.target.files?.[0]; e.target.value = '';
    if (!a) return;
    if (a.size > 40 * 1024 * 1024) { aviso.error('El libro pesa más de 40 MB'); return; }
    setArchivo(a); setFechas({}); setFoto(null);
    imp.planificar({ archivos: [a] }, {});
  };
  const leerTexto = () => {
    if (!texto.trim()) { aviso.error('Cargue la foto o pegue el texto de la solicitud primero'); return; }
    setArchivo(null); setFechas({});
    imp.planificar({ pegado: { texto } }, { foto: foto || undefined, fecha_texto: fechaTexto ? fechaTexto.split('-').reverse().join('/') : undefined });
  };
  const elegirFecha = (hoja, f) => {
    const n = { ...fechas, [hoja]: f.split('-').reverse().join('/') };
    setFechas(n);
    imp.replanificar({ fechas: n });
  };
  const aplicar = async () => {
    if (!(await confirmar({ titulo: '¿Importar las solicitudes?', mensaje: `Se crean ${plan.resumen.nuevos} solicitud(es) históricas en estado «deshuesada».`, textoConfirmar: 'Importar' }))) return;
    const r = await imp.aplicar();
    if (r) { aviso.ok(`Solicitudes importadas: ${r.resultado.resumen.solicitudes}`); setArchivo(null); setTexto(''); setFoto(null); onAplicado?.(); }
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
      <h3>Importar solicitudes históricas (Excel de la planta o foto)</h3>
      <p className="rp-tenue">Suba el libro «Solicitud de Deshuese y Porcionado», o cargue por foto la solicitud impresa. Solo se importan las canales con sacrificio registrado; los cortes sin código quedan «pendientes de codificar» (99).</p>
      <label className="btn btn-secondary" style={{ cursor: canEdit ? 'pointer' : 'not-allowed' }}>
        <Upload size={16} aria-hidden="true" /> {archivo ? archivo.name : 'Elegir el libro .xlsx'}
        <input type="file" accept=".xlsx" hidden disabled={!canEdit || imp.cargando} onChange={elegir} />
      </label>
      <div className="form-group" style={{ marginTop: 'var(--esp-4)' }}>
        <label htmlFor="sd-texto">O por foto de la solicitud impresa (revise el texto antes de la vista previa)</label>
        <LecturaFoto formato="solicitud-deshuese-excel" deshabilitado={!canEdit}
          onTexto={(t, dudas) => { setTexto(t); setFoto({ dudosas: dudas }); }} />
        <textarea id="sd-texto" rows={6} className="imp-pegado" value={texto} disabled={!canEdit} style={{ marginTop: 'var(--esp-2)' }}
          placeholder={EJEMPLO} onChange={e => { setTexto(e.target.value); if (!e.target.value.trim()) setFoto(null); }} />
      </div>
      <div className="form-row">
        <div className="form-group">
          <label htmlFor="sd-fecha">Fecha del sacrificio (si la foto no la trae)</label>
          <input id="sd-fecha" type="date" value={fechaTexto} disabled={!canEdit} onChange={e => setFechaTexto(e.target.value)} />
        </div>
      </div>
      <Boton icono={ListChecks} cargando={imp.cargando} disabled={!canEdit || !texto.trim()} onClick={leerTexto}>Ver vista previa del texto</Boton>
      {imp.cargando && <p className="rp-tenue">Leyendo… (puede tardar con libros grandes)</p>}
      {plan && (
        <div>
          <ResumenPlan resumen={plan.resumen} />
          <VistaPrevia key={plan.huella} filas={plan.filas} columnas={COLUMNAS} />
          <div className="modal-actions">
            <Boton variante="primario" icono={CheckCircle2} cargando={imp.aplicando} disabled={!canEdit || !plan.resumen.nuevos} onClick={aplicar}>Importar {plan.resumen.nuevos} solicitud(es)</Boton>
          </div>
        </div>
      )}
    </div>
  );
}
