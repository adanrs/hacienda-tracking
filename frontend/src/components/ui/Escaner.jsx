import { useEffect, useId, useRef, useState } from 'react';
import { ScanLine, CircleCheck, CircleX } from 'lucide-react';

/*
  Campo para pistola de código de barras en modo teclado.
  - Queda enfocado: al montar, después de cada lectura y si el foco se pierde hacia
    una zona no interactiva (p. ej. un toque con guantes en el fondo).
  - Enter procesa la lectura y limpia el campo; un Enter vacío se ignora.
  - La respuesta se muestra grande, con color + ícono + texto, en una región aria-live.

  Props:
    etiqueta      Texto visible del campo.
    onLeer(cod)   async; devuelve { ok: true|false, titulo, detalle } o lanza un Error
                  (el mensaje del error se muestra como «Bloqueada: …»).
    ayuda         Texto bajo el campo.
    textoEspera   Lo que se ve en la zona de respuesta antes de la primera lectura.
    mantenerFoco  true por defecto.
*/
export default function Escaner({
  etiqueta = 'Escanear código',
  onLeer,
  ayuda = 'Dispare la pistola o digite el código y presione Enter.',
  textoEspera = 'Listo para escanear',
  placeholder = 'Esperando lectura…',
  mantenerFoco = true,
  autoFocus = true,
}) {
  const id = useId();
  const ref = useRef(null);
  const [codigo, setCodigo] = useState('');
  const [resultado, setResultado] = useState(null);
  const [procesando, setProcesando] = useState(false);
  const [enfocado, setEnfocado] = useState(false);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  const procesar = async () => {
    const leido = codigo.trim();
    setCodigo('');
    if (!leido) return;
    setProcesando(true);
    try {
      const r = (await onLeer(leido)) || { ok: true, titulo: 'Lectura registrada' };
      setResultado({ ...r, codigo: leido });
    } catch (err) {
      setResultado({ ok: false, titulo: `Bloqueada: ${err?.message || 'error desconocido'}`, codigo: leido });
    } finally {
      setProcesando(false);
      ref.current?.focus();
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      procesar();
    }
  };

  const onBlur = (e) => {
    setEnfocado(false);
    if (!mantenerFoco) return;
    const destino = e.relatedTarget;
    // Si el foco va a otro control (select, botón, otro input) se respeta; si va «a la nada», se recupera.
    if (!destino || destino === document.body) {
      setTimeout(() => {
        const activo = document.activeElement;
        if (!activo || activo === document.body) ref.current?.focus();
      }, 0);
    }
  };

  let clase = 'espera';
  let Icono = ScanLine;
  let titulo = textoEspera;
  if (procesando) { clase = 'procesando'; titulo = 'Verificando…'; }
  else if (resultado) {
    clase = resultado.ok ? 'ok' : 'error';
    Icono = resultado.ok ? CircleCheck : CircleX;
    titulo = resultado.titulo || (resultado.ok ? 'Etiqueta OK' : 'Bloqueada');
  }

  return (
    <div className="escaner">
      <label className="escaner-etiqueta" htmlFor={id}>
        <ScanLine size={20} aria-hidden="true" /> {etiqueta}
      </label>
      <div className="escaner-campo">
        <input
          ref={ref}
          id={id}
          value={codigo}
          onChange={e => setCodigo(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => setEnfocado(true)}
          onBlur={onBlur}
          placeholder={placeholder}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          inputMode="text"
          enterKeyHint="go"
          aria-describedby={`${id}-ayuda`}
        />
        <button type="button" className="btn btn-primary" onClick={procesar} disabled={procesando}>
          Procesar
        </button>
      </div>
      <div id={`${id}-ayuda`} className={`escaner-ayuda ${enfocado ? '' : 'atento'}`}>
        {enfocado ? ayuda : 'El lector no está activo: toque el campo para seguir escaneando.'}
      </div>

      <div role="status" aria-live="polite" aria-atomic="true">
        <div className={`resultado-escaneo ${clase}`}>
          {procesando
            ? <span className="spinner resultado-icono" aria-hidden="true" />
            : <Icono size={44} className="resultado-icono" aria-hidden="true" />}
          <div>
            <div className="resultado-titulo">{titulo}</div>
            {!procesando && resultado?.detalle && <div className="resultado-detalle">{resultado.detalle}</div>}
            {!procesando && resultado?.codigo && <div className="resultado-codigo">Código leído: {resultado.codigo}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
