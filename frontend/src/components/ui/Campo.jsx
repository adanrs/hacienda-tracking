import { cloneElement, isValidElement, useId } from 'react';
import { CircleAlert } from 'lucide-react';

/*
  Campo de formulario con label asociado, ayuda y error por campo.
    <Campo etiqueta="Peso final (kg)" requerido error={errores.peso_final}>
      <input type="number" value={…} onChange={…} />
    </Campo>
  Asigna id, aria-invalid y aria-describedby al control hijo.
*/
export default function Campo({ etiqueta, requerido, ayuda, error, children, className = '' }) {
  const id = useId();
  const idAyuda = ayuda ? `${id}-ayuda` : undefined;
  const idError = error ? `${id}-error` : undefined;
  const describedBy = [idAyuda, idError].filter(Boolean).join(' ') || undefined;

  const control = isValidElement(children)
    ? cloneElement(children, {
        id: children.props.id || id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describedBy,
        required: children.props.required ?? requerido,
      })
    : children;

  return (
    <div className={`form-group ${className}`}>
      <label htmlFor={(isValidElement(children) && children.props.id) || id}>
        {etiqueta}{requerido && <span className="requerido" aria-hidden="true"> *</span>}
      </label>
      {control}
      {ayuda && <div id={idAyuda} className="campo-ayuda">{ayuda}</div>}
      {error && (
        <div id={idError} className="campo-error">
          <CircleAlert size={14} aria-hidden="true" /> {error}
        </div>
      )}
    </div>
  );
}
