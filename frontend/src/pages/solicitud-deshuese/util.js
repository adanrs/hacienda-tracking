// Utilidades de la Solicitud de deshuese.
import { FilePen, Send, CircleCheck } from 'lucide-react';

// Estado: color + ícono + texto (nunca solo color).
export const ESTADO_SOLICITUD = {
  borrador: { texto: 'Borrador', badge: 'badge-gray', Icono: FilePen },
  enviada: { texto: 'Enviada', badge: 'badge-blue', Icono: Send },
  deshuesada: { texto: 'Deshuesada', badge: 'badge-green', Icono: CircleCheck },
};

export const SEXO = { macho: 'Macho', hembra: 'Hembra' };

// Una canal tiene dos medias: solo se piden 0, 1 o 2 (el backend rechaza cualquier otro valor).
export const MEDIAS = [0, 1, 2];

/** Mismo criterio que el backend para el n.º de canal: letras, dígitos y guion, hasta 10, en mayúsculas. */
export const normalizarNumeroCanal = (v) => String(v ?? '').toUpperCase().replace(/[^0-9A-Z-]/g, '').slice(0, 10);

export const nombreExcel = (s) => `solicitud-deshuese-${s.numero}-${s.fecha_sacrificio}.xlsx`;
