import { useEffect, useRef, useState } from 'react';
import { Camera, Loader2 } from 'lucide-react';
import { api } from '../../services/api';
import { aviso } from '../ui/avisos';

/*
  «Leer por foto»: foto del documento (o PDF escaneado) → servicio de visión → TEXTO editable.
  Nunca aplica nada: el texto vuelve a la pantalla (onTexto) y de ahí pasa por la vista previa.
  Antes de mandar una foto se revisa la NITIDEZ en el navegador: varianza del Laplaciano sobre la
  imagen en escala de grises (una foto movida o desenfocada tiene bordes suaves → varianza baja).
  Si sale borrosa se avisa con un mensaje claro y se puede forzar el envío.
  Sin el servicio configurado en el servidor, el botón queda deshabilitado con su motivo.
*/
const UMBRAL_NITIDEZ = 60; // varianza mínima; calibrado con fotos de etiquetas y reportes (ajustable)
const LADO_ANALISIS = 600;  // se analiza una copia reducida: rápido y estable entre cámaras

export async function medirNitidez(archivo) {
  const url = URL.createObjectURL(archivo);
  try {
    const img = await new Promise((ok, mal) => { const i = new Image(); i.onload = () => ok(i); i.onerror = mal; i.src = url; });
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
  } finally { URL.revokeObjectURL(url); }
}

export default function LecturaFoto({ formato, onTexto, deshabilitado }) {
  const ref = useRef(null);
  const [disponible, setDisponible] = useState(null);
  const [estado, setEstado] = useState(null); // null | 'revisando' | 'transcribiendo'
  const [borrosa, setBorrosa] = useState(null); // { archivo, nitidez }

  useEffect(() => { api.getVisionEstado().then(r => setDisponible(Boolean(r.disponible))).catch(() => setDisponible(false)); }, []);

  const transcribir = async (archivo) => {
    setBorrosa(null);
    setEstado('transcribiendo');
    try {
      const { id } = await api.transcribirFoto(formato, archivo);
      for (let intento = 0; intento < 120; intento++) {
        await new Promise(r => setTimeout(r, 2000));
        const t = await api.getTranscripcion(id);
        if (t.estado === 'listo') { onTexto(t.resultado.texto, t.resultado.dudosas || [], archivo.name); aviso.ok('Foto transcrita: revise el texto antes de ver la vista previa'); return; }
        if (t.estado === 'error') throw new Error(t.error);
      }
      throw new Error('La lectura tardó demasiado');
    } catch (e) {
      aviso.error(e.message, { titulo: 'No se pudo leer la foto' });
    } finally { setEstado(null); }
  };

  const elegir = async (e) => {
    const a = e.target.files?.[0];
    e.target.value = '';
    if (!a) return;
    if (a.type === 'application/pdf' || /\.pdf$/i.test(a.name)) { transcribir(a); return; }
    setEstado('revisando');
    try {
      const nitidez = await medirNitidez(a);
      if (nitidez < UMBRAL_NITIDEZ) { setBorrosa({ archivo: a, nitidez: Math.round(nitidez) }); setEstado(null); return; }
    } catch { /* si el navegador no puede analizarla, se manda igual */ }
    transcribir(a);
  };

  const sinServicio = disponible === false;
  return (
    <div className="lectura-foto">
      <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp,application/pdf,.pdf" capture="environment" hidden onChange={elegir} />
      <button type="button" className="btn btn-secondary" disabled={deshabilitado || sinServicio || disponible === null || Boolean(estado)}
        title={sinServicio ? 'Lectura por foto no disponible: falta configurar el servicio de visión en el servidor' : 'Tome o adjunte una foto, o un PDF escaneado'}
        onClick={() => ref.current?.click()}>
        {estado ? <Loader2 size={16} className="girando" aria-hidden="true" /> : <Camera size={16} aria-hidden="true" />}
        {estado === 'revisando' ? ' Revisando nitidez…' : estado === 'transcribiendo' ? ' Transcribiendo…' : sinServicio ? ' Lectura por foto no disponible' : ' Leer por foto'}
      </button>
      {borrosa && (
        <div className="aviso-inline aviso-alerta" role="alert">
          <p><strong>La foto se ve borrosa</strong> (nitidez {borrosa.nitidez}, mínimo {UMBRAL_NITIDEZ}). Los números pueden leerse mal. Tómela de nuevo con buena luz, sin moverse y de frente al papel.</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => { setBorrosa(null); ref.current?.click(); }}>Tomar otra foto</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => transcribir(borrosa.archivo)}>Usarla de todos modos</button>
          </div>
        </div>
      )}
    </div>
  );
}
