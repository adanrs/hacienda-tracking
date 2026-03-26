// Cow emoji icon - clean and recognizable
export function CowIcon({ size = 32, weight, color }) {
  const fontSize = size * 0.75;
  return (
    <span style={{ fontSize, lineHeight: 1, display: 'inline-block', width: size, height: size, textAlign: 'center' }} role="img" aria-label="vaca">
      {color === '#ec4899' ? '\u{1F404}' : '\u{1F402}'}
    </span>
  );
}

// Animated walking cow for loading states
export function CowWalking({ size = 48 }) {
  return (
    <div style={{ display: 'inline-block', animation: 'cowWalk 1.5s ease-in-out infinite' }}>
      <span style={{ fontSize: size * 0.75, lineHeight: 1 }}>&#x1F404;</span>
      <style>{`
        @keyframes cowWalk {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(10px); }
          50% { transform: translateX(20px); }
          75% { transform: translateX(10px); }
        }
      `}</style>
    </div>
  );
}

// Weight progress indicator with cow emoji
export function CowWeightIndicator({ pesoNacimiento, pesoActual, pesoObjetivo = 500 }) {
  const progress = pesoActual ? Math.min(100, (pesoActual / pesoObjetivo) * 100) : 0;
  const ganancia = pesoActual && pesoNacimiento ? pesoActual - pesoNacimiento : null;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{ fontSize: 36, lineHeight: 1 }}>&#x1F404;</span>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: '#6b7280', marginBottom: 4 }}>
          <span>{pesoActual ? `${pesoActual} kg` : 'Sin peso'}</span>
          {ganancia !== null && <span style={{ color: '#16a34a' }}>+{ganancia} kg ganados</span>}
        </div>
        <div style={{ height: 8, background: '#e5e7eb', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{
            height: '100%',
            width: `${progress}%`,
            background: `linear-gradient(90deg, #dcfce7, #16a34a)`,
            borderRadius: 4,
            transition: 'width 0.5s ease'
          }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#9ca3af', marginTop: 2 }}>
          <span>Nac: {pesoNacimiento || '-'} kg</span>
          <span>Obj: {pesoObjetivo} kg</span>
        </div>
      </div>
    </div>
  );
}
