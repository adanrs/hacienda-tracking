// Utilidades compartidas por las pantallas del Reporte Diario de Producción.
import { CircleCheck, CircleAlert, ScanLine, FileQuestion } from 'lucide-react';

/** Fecha local de hoy en AAAA-MM-DD (toISOString daría el día UTC, que en CR cambia a las 6 p. m.). */
export function hoyIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 1,984.25: formato numérico que usa el cliente (no toLocaleString('es-CR'), que usa espacios y coma). */
export function fmtKg(n) {
  if (n === null || n === undefined || n === '' || Number.isNaN(Number(n))) return '—';
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtDif(n, decimales = 2) {
  if (n === null || n === undefined) return '—';
  const v = Number(n);
  if (v === 0) return decimales ? '0.00' : '0';
  const s = decimales ? fmtKg(Math.abs(v)) : String(Math.abs(v));
  return `${v > 0 ? '+' : '−'}${s}`;
}

export const lote2 = (n) => String(n).padStart(2, '0');

export const fechaCorta = (iso) => (iso ? iso.split('-').reverse().join('/') : '—');

// Estado por fila: color + ícono + texto (nunca solo color).
export const ESTADO_FILA = {
  cuadra: { texto: 'Cuadra', badge: 'badge-green', Icono: CircleCheck },
  diferencia: { texto: 'Diferencia', badge: 'badge-red', Icono: CircleAlert },
  solo_ciisa: { texto: 'No escaneado', badge: 'badge-orange', Icono: ScanLine },
  solo_escaneo: { texto: 'No está en CIISA', badge: 'badge-purple', Icono: FileQuestion },
};

/** Número desde lo que se digita o pega: «97.40», «97,40». */
export function numeroDe(texto) {
  if (typeof texto === 'number') return texto;
  let s = String(texto ?? '').trim().replace(/\s/g, '');
  if (!s) return NaN;
  if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.');
  else s = s.replace(/,/g, '');
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
}

/**
 * Filas pegadas desde el reporte de CIISA (Excel, PDF o correo):
 *   «11163  BEEF TRIMMINGS  97.40  KGS  4»   o con tabuladores.
 * Las líneas que no empiezan con un código (títulos, totales) se ignoran.
 */
export function parsearFilasPegadas(texto) {
  const lineas = [];
  const errores = [];
  String(texto || '').split(/\r?\n/).forEach((cruda, i) => {
    const l = cruda.trim();
    if (!l || !/^\d/.test(l)) return;
    if (/^total/i.test(l)) return;
    let partes;
    if (l.includes('\t')) {
      const c = l.split('\t').map(x => x.trim());
      if (c.length >= 5) partes = { articulo: c[0], descripcion: c[1], peso: c[2], unidad: c[3], cajas: c[4] };
      else if (c.length === 4) partes = { articulo: c[0], descripcion: c[1], peso: c[2], unidad: 'KGS', cajas: c[3] };
    } else {
      const m = l.match(/^(\d{5})\s+(.+?)\s+(\d[\d.,]*)\s+(?:(KGS?|KILOS)\s+)?(\d+)$/i);
      if (m) partes = { articulo: m[1], descripcion: m[2], peso: m[3], unidad: (m[4] || 'KGS').toUpperCase(), cajas: m[5] };
    }
    if (!partes) { errores.push(`Línea ${i + 1}: no se reconoce «${l.slice(0, 50)}»`); return; }
    const peso = numeroDe(partes.peso);
    lineas.push({ ...partes, peso: Number.isNaN(peso) ? partes.peso : String(peso) });
  });
  return { lineas, errores };
}

/** Tabla posición → arete pegada del correo: «06  72ELF» por línea. */
export function parsearAretesPegados(texto) {
  const aretes = [];
  const errores = [];
  String(texto || '').split(/\r?\n/).forEach((cruda, i) => {
    const l = cruda.trim();
    if (!l || /arete/i.test(l)) return;
    const m = l.match(/^(\d{1,4})[\s\t;,]+([A-Za-z0-9-]{3,10})$/);
    if (!m) { errores.push(`Línea ${i + 1}: use «posición arete», p. ej. 06 72ELF`); return; }
    aretes.push({ posicion: lote2(Number(m[1])), arete: m[2].toUpperCase() });
  });
  return { aretes, errores };
}
