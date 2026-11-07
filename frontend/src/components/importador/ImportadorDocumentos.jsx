import { useRef, useState } from 'react';
import { Upload, CheckCircle2, ListChecks, X } from 'lucide-react';
import Boton from '../ui/Boton';
import { confirmar } from '../ui/confirmar';
import { aviso } from '../ui/avisos';
import VistaPrevia from './VistaPrevia';
import ResumenPlan from './ResumenPlan';
import useImportacion from './useImportacion';
import LecturaFoto from './LecturaFoto';

/*
  Importar documentos sueltos (guía de movilización del MAG, ajustes y traslados de custodia de
  CIISA): uno o varios archivos (PDF con texto, Word .docx, texto) y/o la foto leída o el texto
  pegado. Mismo flujo que el resto del importador: vista previa (nada se guarda) → «Aplicar» con
  confirmación. Lo leído por foto queda en el cuadro de texto para corregirlo antes de la vista previa,
  y sus filas dudosas salen marcadas «Leído por foto: revisar».

  Props:
    formato        id del formato (backend lib/importador/formatos.js)
    accept         extensiones para el selector de archivos
    ayuda          párrafo de explicación
    placeholder    ejemplo de texto pegado
    columnas       columnas de la vista previa por fila
    encabezados    (plan) => resumen por documento arriba de las filas
    textoAplicar   (plan) => partes del mensaje de confirmación
    resultado      (resultado) => contenido del aviso «aplicado»
*/
const MAX_MB = 5;
const MAX_ARCHIVOS = 40;

export default function ImportadorDocumentos({ formato, accept, ayuda, placeholder, columnas, encabezados, textoAplicar, resultado, canEdit, onAplicado, idTexto }) {
  const refArchivos = useRef(null);
  const [archivos, setArchivos] = useState([]);
  const [texto, setTexto] = useState('');
  const [foto, setFoto] = useState(null); // { dudosas } si el texto salió de una foto
  const imp = useImportacion(formato);
  const { plan } = imp;

  const entrada = (a, t) => ({ archivos: a, pegado: t.trim() ? { texto: t } : undefined });
  const revisar = (a = archivos, t = texto) => {
    if (!a.length && !t.trim()) { aviso.error('Adjunte el archivo, cargue la foto o pegue el texto primero'); return; }
    imp.planificar(entrada(a, t), { foto: foto && t.trim() ? foto : undefined });
  };

  const elegir = (e) => {
    const nuevos = [...(e.target.files || [])];
    e.target.value = '';
    const grandes = nuevos.filter(f => f.size > MAX_MB * 1024 * 1024);
    if (grandes.length) { aviso.error(`${grandes.map(f => f.name).join(', ')} pesa(n) más de ${MAX_MB} MB`); return; }
    const todos = [...archivos, ...nuevos.filter(n => !archivos.some(a => a.name === n.name))].slice(0, MAX_ARCHIVOS);
    setArchivos(todos);
    revisar(todos, texto);
  };
  const quitar = (nombre) => {
    const resto = archivos.filter(x => x.name !== nombre);
    setArchivos(resto);
    if (resto.length || texto.trim()) revisar(resto, texto); else imp.limpiar();
  };

  const aplicar = async () => {
    const r = plan.resumen;
    const ok = await confirmar({
      titulo: '¿Aplicar la importación?',
      mensaje: `${textoAplicar(plan)}${r.errores ? ` Las ${r.errores} fila(s) con error NO se importan.` : ''} Todo se guarda junto: si algo falla, no se guarda nada.`,
      textoConfirmar: 'Aplicar',
    });
    if (!ok) return;
    const res = await imp.aplicar();
    if (res) {
      aviso.ok('Importación aplicada');
      setArchivos([]); setTexto(''); setFoto(null);
      onAplicado?.(res);
    }
  };

  const aplicables = plan ? plan.filas.filter(f => f.accion === 'nuevo' || f.accion === 'actualizar').length
    + (plan.guias || plan.documentos || []).filter(d => d.accion === 'actualizar').length : 0;

  return (
    <>
      <div className="card">
        <p className="rp-nota">{ayuda}</p>
        <div className="rp-acciones">
          <Boton variante="primario" icono={Upload} cargando={imp.cargando} disabled={!canEdit} onClick={() => refArchivos.current?.click()}>
            {archivos.length ? 'Agregar otro archivo…' : 'Elegir archivo…'}
          </Boton>
          <input ref={refArchivos} type="file" accept={accept} multiple hidden onChange={elegir} />
        </div>
        {archivos.length > 0 && (
          <ul className="lista-archivos" aria-label="Archivos elegidos">
            {archivos.map(a => (
              <li key={a.name}>
                <span>{a.name}</span>
                <button type="button" className="btn-icon" aria-label={`Quitar ${a.name}`} disabled={imp.cargando} onClick={() => quitar(a.name)}><X size={14} aria-hidden="true" /></button>
              </li>
            ))}
          </ul>
        )}
        <div className="form-group imp-documento-texto">
          <label htmlFor={idTexto}>O cargue el documento por foto (una por página) o pegue el texto, y revíselo</label>
          <LecturaFoto formato={formato} deshabilitado={!canEdit}
            onTexto={(t, dudas) => { setTexto(t); setFoto({ dudosas: dudas }); }} />
          <textarea id={idTexto} rows={6} className="imp-pegado" value={texto} disabled={!canEdit}
            placeholder={placeholder}
            onChange={e => { setTexto(e.target.value); if (!e.target.value.trim()) setFoto(null); }} />
          <Boton icono={ListChecks} cargando={imp.cargando} disabled={!canEdit || (!texto.trim() && !archivos.length)} onClick={() => revisar()}>Ver vista previa</Boton>
        </div>
      </div>

      {imp.resultado && (
        <div className="banner ok" role="status">
          <CheckCircle2 size={18} aria-hidden="true" />
          <div><strong>Importación aplicada.</strong> {resultado(imp.resultado.resultado)}</div>
        </div>
      )}

      {plan && (
        <div className="card">
          <div className="card-header">
            <h3>Vista previa{plan.archivo_nombre ? ` de «${plan.archivo_nombre}»` : ''}</h3>
            <Boton variante="primario" icono={CheckCircle2} cargando={imp.aplicando} disabled={!canEdit || aplicables === 0} onClick={aplicar}>
              Aplicar
            </Boton>
          </div>
          <ResumenPlan resumen={plan.resumen} />
          {aplicables === 0 && !plan.resumen.errores && (
            <div className="banner info" role="status">No hay nada nuevo que guardar: este documento ya está importado tal cual.</div>
          )}
          {encabezados(plan)}
          <VistaPrevia key={plan.huella} filas={plan.filas} columnas={columnas} />
        </div>
      )}
    </>
  );
}
