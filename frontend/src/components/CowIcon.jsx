// SVG Cow icon with optional size indicator (for weight visualization)
export function CowIcon({ size = 32, weight, maxWeight = 500, color = '#1a1a2e' }) {
  // Scale cow size based on weight (visual indicator of how fat the cow is)
  const scale = weight ? 0.7 + (Math.min(weight, maxWeight) / maxWeight) * 0.5 : 1;
  const bodyWidth = weight ? 18 + (Math.min(weight, maxWeight) / maxWeight) * 8 : 22;

  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Body - wider when heavier */}
      <ellipse cx="20" cy="22" rx={bodyWidth * scale} ry={10 * scale} fill={color} opacity="0.85" />
      {/* Head */}
      <circle cx="33" cy="16" r={6 * scale} fill={color} opacity="0.9" />
      {/* Horns */}
      <path d={`M30 12 Q28 6 25 8`} stroke={color} strokeWidth="1.5" fill="none" />
      <path d={`M36 12 Q38 6 41 8`} stroke={color} strokeWidth="1.5" fill="none" />
      {/* Eye */}
      <circle cx="35" cy="15" r="1" fill="white" />
      {/* Nose */}
      <ellipse cx="37" cy="18" rx="2" ry="1.5" fill={color} opacity="0.6" />
      {/* Legs */}
      <line x1="12" y1="30" x2="12" y2="37" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <line x1="18" y1="30" x2="18" y2="37" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <line x1="24" y1="30" x2="24" y2="37" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <line x1="28" y1="30" x2="28" y2="37" stroke={color} strokeWidth="2" strokeLinecap="round" />
      {/* Tail */}
      <path d="M4 20 Q1 16 3 12" stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round" />
      {/* Spots (if weight is above 200) */}
      {weight > 200 && <>
        <circle cx="16" cy="20" r="3" fill="white" opacity="0.3" />
        <circle cx="22" cy="24" r="2" fill="white" opacity="0.3" />
      </>}
    </svg>
  );
}

// Animated walking cow for loading states
export function CowWalking({ size = 48 }) {
  return (
    <div style={{ display: 'inline-block', animation: 'cowWalk 1.5s ease-in-out infinite' }}>
      <CowIcon size={size} color="#16a34a" />
      <style>{`
        @keyframes cowWalk {
          0%, 100% { transform: translateX(0) scaleX(1); }
          25% { transform: translateX(10px) scaleX(1); }
          50% { transform: translateX(20px) scaleX(1); }
          75% { transform: translateX(10px) scaleX(1); }
        }
      `}</style>
    </div>
  );
}

// Weight progress indicator with cow
export function CowWeightIndicator({ pesoNacimiento, pesoActual, pesoObjetivo = 500 }) {
  const progress = pesoActual ? Math.min(100, (pesoActual / pesoObjetivo) * 100) : 0;
  const ganancia = pesoActual && pesoNacimiento ? pesoActual - pesoNacimiento : null;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <CowIcon size={40} weight={pesoActual} color="#1a1a2e" />
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
