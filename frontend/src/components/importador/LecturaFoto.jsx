import { useEffect, useRef, useState } from 'react';
import { Camera, Images, Loader2, X, ScanText } from 'lucide-react';
import { api } from '../../services/api';
import { aviso } from '../ui/avisos';
import { unirPaginas, medidaReducida, textoAvance } from './paginas';

/*
  «Cargar por foto»: una foto por página del documento → servicio de visión → TEXTO editable.
  Nunca aplica nada: el texto vuelve a la pantalla (onTexto) y de ahí pasa por el MISMO procesador
  que el archivo o el pegado y por su vista previa; aplicar sigue pidiendo confirmación.

  En el celular (Juan Carlos carga los documentos con fotos para no digitar):
    - «Tomar foto» abre la cámara trasera (accept image/* + capture="environment"); cada foto es
      una página y se pueden agregar varias antes de leer. «Elegir fotos» abre la galería (varias).
    - Cada foto se revisa (NITIDEZ: varianza del Laplaciano en escala de grises; una foto movida
      tiene bordes suaves → varianza baja) y se COMPRIME en el navegador a 1600 px de lado y JPEG:
      una foto de celular pesa 3–8 MB y el gateway acepta hasta 24 MB por pedido (en base64); además
      el modelo reduce a 1600 px de todos modos, así que mandar más solo gasta datos y tiempo.
    - Mientras lee muestra «Leyendo página n de m…» con una barra de avance.
    - Si falla una página o el servicio no está, mensaje claro: las otras páginas igual se usan y
      siempre queda pegar el texto o subir el archivo en la misma pantalla.
  Sin el servicio configurado en el servidor, el botón queda deshabilitado con su motivo.
*/
const UMBRAL_NITIDEZ = 60; // varianza mínima; calibrado con fotos de etiquetas y reportes (ajustable)
const LADO_ANALISIS = 600;  // la nitidez se mide sobre una copia reducida: rápido y estable entre cámaras
const LADO_ENVIO = 1600;    // lo que lee el modelo (kiwi_media_mcp reduce a 1600 px igual)
const CALIDAD_JPEG = 0.85;
const MAX_PAGINAS = 10;
const ESPERA_MS = 2000;
const INTENTOS = 120; // 4 minutos por página como máximo

function cargarImagen(archivo) {
  const url = URL.createObjectURL(archivo);
  return new Promise((ok, mal) => {
    const i = new Image();
    i.onload = () => ok({ img: i, url });
    i.onerror = () => { URL.revokeObjectURL(url); mal(new Error('El navegador no pudo abrir la foto (use JPG o PNG)')); };
    i.src = url;
  });
}

function nitidezDe(img) {
  const escala = Math.min(1, LADO_ANALISIS / Math.max(img.width, img.height));
  const w = Math.max(3, Math.round(img.width * escala));
  const h = Math.max(3, Math.round(img.height * escala));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const gris = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) gris[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  let suma = 0; let suma2 = 0; let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      const lap = gris[p - w] + gris[p + w] + gris[p - 1] + gris[p + 1] - 4 * gris[p];
      suma += lap; suma2 += lap * lap; n++;
    }
  }
  const media = suma / n;
  return suma2 / n - media * media;
}

/** Nitidez de una foto (se mantiene exportada: la usan otras pantallas). */
export async function medirNitidez(archivo) {
  const { img, url } = await cargarImagen(archivo);
  try { return nitidezDe(img); } finally { URL.revokeObjectURL(url); }
}

/** Foto → JPEG de 1600 px de lado como máximo (respeta la orientación de la cámara). */
function comprimir(img, nombre) {
  const { ancho, alto } = medidaReducida(img.naturalWidth || img.width, img.naturalHeight || img.height, LADO_ENVIO);
  const canvas = document.createElement('canvas');
  canvas.width = ancho; canvas.height = alto;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // un PNG con transparencia no queda negro en JPEG
  ctx.fillRect(0, 0, ancho, alto);
  ctx.drawImage(img, 0, 0, ancho, alto);
  return new Promise((ok, mal) => canvas.toBlob((b) => (b ? ok(new File([b], nombre, { type: 'image/jpeg' })) : mal(new Error('No se pudo preparar la foto'))), 'image/jpeg', CALIDAD_JPEG));
}

let siguiente = 1;

export default function LecturaFoto({ formato, onTexto, deshabilitado }) {
  const refCamara = useRef(null);
  const refGaleria = useRef(null);
  const [disponible, setDisponible] = useState(null);
  const [paginas, setPaginas] = useState([]); // [{ id, archivo, vista, nitidez, borrosa, error }]
  const [preparando, setPreparando] = useState(false);
  const [avance, setAvance] = useState(null); // { actual, total, segundos }
  const [falla, setFalla] = useState(null);
  const vivo = useRef(true);

  useEffect(() => { api.getVisionEstado().then(r => setDisponible(Boolean(r.disponible))).catch(() => setDisponible(false)); }, []);
  // Al salir de la pantalla: liberar las miniaturas y cortar la espera de una lectura en curso.
  const paginasRef = useRef(paginas);
  paginasRef.current = paginas;
  useEffect(() => () => { vivo.current = false; paginasRef.current.forEach(p => URL.revokeObjectURL(p.vista)); }, []);

  const agregar = async (e) => {
    const elegidas = [...(e.target.files || [])];
    e.target.value = '';
    if (!elegidas.length) return;
    setFalla(null);
    const lugar = MAX_PAGINAS - paginas.length;
    if (elegidas.length > lugar) aviso.error(`Máximo ${MAX_PAGINAS} páginas por lectura: se tomaron las primeras ${Math.max(0, lugar)}`);
    setPreparando(true);
    const nuevas = [];
    for (const a of elegidas.slice(0, Math.max(0, lugar))) {
      const id = siguiente++;
      try {
        const { img, url } = await cargarImagen(a);
        let nitidez = null;
        try { nitidez = Math.round(nitidezDe(img)); } catch { /* sin análisis: se manda igual */ }
        const archivo = await comprimir(img, `pagina-${id}.jpg`);
        URL.revokeObjectURL(url);
        nuevas.push({ id, archivo, vista: URL.createObjectURL(archivo), nitidez, borrosa: nitidez != null && nitidez < UMBRAL_NITIDEZ });
      } catch (err) {
        aviso.error(`«${a.name}»: ${err.message}`, { titulo: 'No se pudo usar la foto' });
      }
    }
    setPreparando(false);
    setPaginas(ps => [...ps, ...nuevas]);
  };

  const quitar = (id) => setPaginas(ps => {
    const p = ps.find(x => x.id === id);
    if (p) URL.revokeObjectURL(p.vista);
    return ps.filter(x => x.id !== id);
  });

  const transcribir = async (archivo, actual, total) => {
    const inicio = Date.now();
    setAvance({ actual, total, segundos: 0 });
    const { id } = await api.transcribirFoto(formato, archivo);
    for (let intento = 0; intento < INTENTOS; intento++) {
      await new Promise(r => setTimeout(r, ESPERA_MS));
      if (!vivo.current) throw new Error('cancelada');
      setAvance({ actual, total, segundos: Math.round((Date.now() - inicio) / 1000) });
      const t = await api.getTranscripcion(id);
      if (t.estado === 'listo') return t.resultado;
      if (t.estado === 'error') throw new Error(t.error);
    }
    throw new Error('La lectura tardó demasiado');
  };

  const leer = async () => {
    if (!paginas.length) return;
    setFalla(null);
    const textos = []; const dudosas = []; const fallidas = [];
    const lote = paginas;
    for (let i = 0; i < lote.length; i++) {
      try {
        const r = await transcribir(lote[i].archivo, i + 1, lote.length);
        textos.push(r.texto);
        dudosas.push(...(r.dudosas || []));
      } catch (err) {
        if (!vivo.current) return;
        fallidas.push({ ...lote[i], error: err.message });
      }
    }
    if (!vivo.current) return;
    setAvance(null);
    // Las que se leyeron salen de la lista; las que fallaron quedan para reintentar.
    lote.filter(p => !fallidas.some(f => f.id === p.id)).forEach(p => URL.revokeObjectURL(p.vista));
    setPaginas(fallidas);
    if (textos.length) {
      onTexto(unirPaginas(textos), [...new Set(dudosas)], lote.length > 1 ? `${textos.length} foto(s)` : 'foto');
      aviso.ok(textos.length > 1 ? `${textos.length} páginas leídas: revise el texto antes de ver la vista previa` : 'Foto leída: revise el texto antes de ver la vista previa');
    }
    if (fallidas.length) {
      setFalla(textos.length
        ? `No se pudo leer ${fallidas.length === 1 ? 'una página' : `${fallidas.length} páginas`} (${fallidas[0].error}). Lo leído ya está en el cuadro de texto; reintente la que falta o complétela a mano.`
        : `No se pudo leer la foto: ${fallidas[0].error}. Puede reintentar, pegar el texto o subir el archivo en esta misma pantalla.`);
    }
  };

  const sinServicio = disponible === false;
  const ocupado = preparando || Boolean(avance);
  const bloqueado = deshabilitado || sinServicio || disponible === null || ocupado;
  const borrosas = paginas.filter(p => p.borrosa).length;
  return (
    <div className="lectura-foto">
      <input ref={refCamara} type="file" accept="image/*" capture="environment" multiple hidden onChange={agregar} />
      <input ref={refGaleria} type="file" accept="image/*" multiple hidden onChange={agregar} />
      <div className="lectura-foto-botones">
        <button type="button" className="btn btn-secondary" disabled={bloqueado || paginas.length >= MAX_PAGINAS}
          title={sinServicio ? 'Cargar por foto no disponible: falta configurar el servicio de visión en el servidor' : 'Abre la cámara: una foto por página del documento'}
          onClick={() => refCamara.current?.click()}>
          {preparando ? <Loader2 size={16} className="girando" aria-hidden="true" /> : <Camera size={16} aria-hidden="true" />}
          {sinServicio ? ' Cargar por foto no disponible' : preparando ? ' Preparando foto…' : paginas.length ? ' Otra página' : ' Cargar por foto'}
        </button>
        {!sinServicio && (
          <button type="button" className="btn btn-secondary" disabled={bloqueado || paginas.length >= MAX_PAGINAS} onClick={() => refGaleria.current?.click()}>
            <Images size={16} aria-hidden="true" /> Elegir fotos
          </button>
        )}
      </div>
      {sinServicio && <small className="rp-tenue">Puede pegar el texto o subir el archivo.</small>}

      {paginas.length > 0 && (
        <div className="lectura-foto-paginas">
          <ol aria-label="Páginas a leer">
            {paginas.map((p, i) => (
              <li key={p.id} className={p.borrosa || p.error ? 'pagina-alerta' : ''}>
                <img src={p.vista} alt={`Página ${i + 1}`} />
                <span>Pág. {i + 1}{p.borrosa ? ' · borrosa' : ''}{p.error ? ' · no se leyó' : ''}</span>
                <button type="button" className="btn-icon" aria-label={`Quitar la página ${i + 1}`} disabled={ocupado} onClick={() => quitar(p.id)}><X size={14} aria-hidden="true" /></button>
              </li>
            ))}
          </ol>
          {borrosas > 0 && (
            <p className="aviso-inline aviso-alerta" role="alert">
              <strong>{borrosas === 1 ? 'Una foto se ve borrosa' : `${borrosas} fotos se ven borrosas`}</strong> (nitidez menor a {UMBRAL_NITIDEZ}): los números pueden leerse mal. Quítela y tómela de nuevo con buena luz, sin moverse y de frente al papel, o léala de todos modos y revise bien el texto.
            </p>
          )}
          <button type="button" className="btn btn-primary" disabled={bloqueado} onClick={leer}>
            {avance ? <Loader2 size={16} className="girando" aria-hidden="true" /> : <ScanText size={16} aria-hidden="true" />}
            {' '}{avance ? textoAvance(avance.actual, avance.total, avance.segundos) : `Leer ${paginas.length === 1 ? 'la foto' : `${paginas.length} páginas`}`}
          </button>
          {avance && <progress className="lectura-foto-avance" max={avance.total} value={avance.actual - 1} aria-label="Avance de la lectura" />}
        </div>
      )}
      {falla && <p className="aviso-inline aviso-error" role="alert">{falla}</p>}
    </div>
  );
}
