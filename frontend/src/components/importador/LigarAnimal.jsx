import { useState } from 'react';
import { Link2, Unlink } from 'lucide-react';
import Boton from '../ui/Boton';
import { aviso } from '../ui/avisos';

/*
  Ligue manual de un documento (o de un DIIO de la guía del MAG) a un animal, por su arete. Se usa
  cuando la importación no pudo ligarlo sin dudas («sin animal»). El servidor valida que el arete
  exista y guarda el ligue como manual: una re-importación del mismo documento ya no lo cambia.
  Se escribe el arete en vez de elegirlo de una lista porque los animales de la planta ya no están
  activos (sacrificados) y la búsqueda de animales solo trae los activos.
*/
export default function LigarAnimal({ id, aretActual, onLigar, deshabilitado }) {
  const [arete, setArete] = useState('');
  const [guardando, setGuardando] = useState(false);

  const enviar = async (valor) => {
    setGuardando(true);
    try {
      await onLigar(valor);
      aviso.ok(valor ? `Ligado a ${valor}` : 'Quedó sin animal');
      setArete('');
    } catch (err) {
      aviso.error(err.message, { titulo: 'No se pudo ligar' });
    } finally { setGuardando(false); }
  };

  return (
    <form className="ligar-animal" onSubmit={(e) => { e.preventDefault(); if (arete.trim()) enviar(arete.trim().toUpperCase()); }}>
      <label htmlFor={`ligar-${id}`} className="sr-only">Arete del animal</label>
      <input id={`ligar-${id}`} value={arete} placeholder={aretActual ? 'Otro arete' : 'Arete'} disabled={deshabilitado || guardando}
        autoComplete="off" spellCheck={false} maxLength={50} onChange={(e) => setArete(e.target.value)} />
      <Boton type="submit" tamano="sm" icono={Link2} cargando={guardando} disabled={deshabilitado || !arete.trim()}>Ligar</Boton>
      {aretActual && (
        <Boton tamano="sm" icono={Unlink} disabled={deshabilitado || guardando} onClick={() => enviar(null)}>Quitar</Boton>
      )}
    </form>
  );
}
