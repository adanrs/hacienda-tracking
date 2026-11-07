// Cow emoji icon - clean and recognizable
export function CowIcon({ size = 32, weight, color }) {
  const fontSize = size * 0.75;
  return (
    <span style={{ fontSize, lineHeight: 1, display: 'inline-block', width: size, height: size, textAlign: 'center' }} role="img" aria-label={color === '#ec4899' ? 'hembra' : 'macho'}>
      {color === '#ec4899' ? '\u{1F404}' : '\u{1F402}'}
    </span>
  );
}

// Avance de peso hacia el objetivo. La barra se escala con transform (no se anima width) y los
// textos usan los tokens del sistema: los grises claros anteriores no llegaban a 4.5:1.
export function CowWeightIndicator({ pesoNacimiento, pesoActual, pesoObjetivo = 500 }) {
  const actual = Number(pesoActual) || 0;
  const nacimiento = Number(pesoNacimiento) || 0;
  const avance = actual ? Math.min(1, actual / pesoObjetivo) : 0;
  const ganancia = actual && nacimiento ? actual - nacimiento : null;

  return (
    <div className="avance-peso">
      <div className="ocupacion-texto">
        <span>{actual ? `${actual.toFixed(2)} kg` : 'Sin peso'}</span>
        {ganancia !== null && <span className="texto-ok">+{ganancia.toFixed(0)} kg ganados</span>}
      </div>
      <div className="barra" role="img" aria-label={`${Math.round(avance * 100)} % del peso objetivo`}>
        <div className="barra-relleno" style={{ transform: `scaleX(${avance})` }} />
      </div>
      <div className="ocupacion-texto avance-peso-pie">
        <span>Al nacer: {nacimiento ? `${nacimiento} kg` : '-'}</span>
        <span>Objetivo: {pesoObjetivo} kg</span>
      </div>
    </div>
  );
}
