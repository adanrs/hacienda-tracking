import { Fragment, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, CircleAlert, TriangleAlert } from 'lucide-react';

/*
  Vista previa genérica de una importación (la usan Ganadero SG y Sacrificio CIISA).
  Cada fila del plan trae: fila, accion (nuevo | actualizar | sin_cambios | error), errores,
  avisos, cambios [{ etiqueta, antes, despues }] y acciones [{ entidad, accion, … }].
  Las columnas propias de cada formato llegan por `columnas` ([{ titulo, valor: (fila) => …, num }]).
  Filtros por estado y paginación de 25 filas: un reporte de hato puede traer cientos.
  Texto leído por FOTO (backend lib/importador/foto.js): las filas traen `leido_por_foto` y, las que
  hay que revisar contra el papel, `revisar_foto`; se avisa arriba y se marcan en la columna Resultado.
*/
const POR_PAGINA = 25;
const FILTROS = [
  { id: 'todas', texto: 'Todas' },
  { id: 'nuevo', texto: 'Nuevos' },
  { id: 'actualizar', texto: 'Se actualizan' },
  { id: 'sin_cambios', texto: 'Sin cambios' },
  { id: 'error', texto: 'Con error' },
  { id: 'avisos', texto: 'Con avisos' },
];
export const ETIQUETA_ACCION = {
  nuevo: { texto: 'Nuevo', clase: 'badge-green' },
  actualizar: { texto: 'Se actualiza', clase: 'badge-blue' },
  sin_cambios: { texto: 'Sin cambios', clase: 'badge-gray' },
  error: { texto: 'Error: no se importa', clase: 'badge-red' },
};
const NOMBRE_ENTIDAD = { pesaje: 'Pesaje', vacuna: 'Vacuna', guia: 'Guía de transporte' };

const valorTexto = (v) => (v == null || v === '' ? '—' : String(v));

function cuenta(filas, id) {
  if (id === 'todas') return filas.length;
  if (id === 'avisos') return filas.filter(f => f.avisos?.length).length;
  return filas.filter(f => f.accion === id).length;
}

export default function VistaPrevia({ filas, columnas, renderExtra, filtroInicial }) {
  const [filtro, setFiltro] = useState(filtroInicial || (filas.some(f => f.accion === 'error') ? 'error' : 'todas'));
  const [pagina, setPagina] = useState(0);
  const [abiertas, setAbiertas] = useState(() => new Set());

  const visibles = useMemo(() => {
    if (filtro === 'todas') return filas;
    if (filtro === 'avisos') return filas.filter(f => f.avisos?.length);
    return filas.filter(f => f.accion === filtro);
  }, [filas, filtro]);
  const paginas = Math.max(1, Math.ceil(visibles.length / POR_PAGINA));
  const pag = Math.min(pagina, paginas - 1);
  const enPagina = visibles.slice(pag * POR_PAGINA, (pag + 1) * POR_PAGINA);

  const alternar = (fila) => setAbiertas((s) => {
    const n = new Set(s);
    if (n.has(fila)) n.delete(fila); else n.add(fila);
    return n;
  });

  const porFoto = filas.some(f => f.leido_por_foto);
  const aRevisar = filas.filter(f => f.revisar_foto).length;
  return (
    <div>
      {porFoto && (
        <div className={`banner ${aRevisar ? 'error' : 'info'}`} role="status">
          Datos leídos de una foto{aRevisar ? <>: <strong>{aRevisar} fila(s) para revisar contra el papel</strong> (marcadas «Leído por foto: revisar»). Corrija el texto y vuelva a leerlo si algo no coincide.</> : '. Compare los totales con el papel antes de aplicar.'}
        </div>
      )}
      <div className="tabs" role="group" aria-label="Filtrar filas de la vista previa">
        {FILTROS.map(({ id, texto }) => (
          <button key={id} type="button" className={`tab ${filtro === id ? 'active' : ''}`} aria-pressed={filtro === id}
            onClick={() => { setFiltro(id); setPagina(0); }}>
            {texto} <span className="badge badge-gray" style={{ marginLeft: 6 }}>{cuenta(filas, id)}</span>
          </button>
        ))}
      </div>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th><span className="sr-only">Detalle</span></th>
              <th className="num">Fila</th>
              <th>Resultado</th>
              {columnas.map(c => <th key={c.titulo} className={c.num ? 'num' : ''}>{c.titulo}</th>)}
              <th>Observaciones</th>
            </tr>
          </thead>
          <tbody>
            {enPagina.length === 0 && (
              <tr><td colSpan={columnas.length + 4} className="rp-tenue">No hay filas con este filtro.</td></tr>
            )}
            {enPagina.map((f) => {
              const abierta = abiertas.has(f.fila);
              const et = ETIQUETA_ACCION[f.accion] || ETIQUETA_ACCION.sin_cambios;
              const detalle = (f.cambios?.length || 0) + (f.acciones?.length || 0) + (f.errores?.length || 0) + (f.avisos?.length || 0);
              return (
                <Fragment key={f.fila}>
                  <tr className={f.accion === 'error' ? 'rp-fila-dif' : f.avisos?.length ? 'rp-fila-falta' : ''}>
                    <td>
                      {detalle > 0 && (
                        <button type="button" className="btn-icon" aria-expanded={abierta} aria-label={`${abierta ? 'Ocultar' : 'Ver'} detalle de la fila ${f.fila}`} onClick={() => alternar(f.fila)}>
                          {abierta ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
                        </button>
                      )}
                    </td>
                    <td className="num">{f.fila}</td>
                    <td>
                      <span className={`badge ${et.clase}`}>{et.texto}</span>
                      {f.revisar_foto && <> <span className="badge badge-orange badge-foto" title="La lectura de la foto no fue segura o el dato no cuadra: compárelo con el papel">Leído por foto: revisar</span></>}
                    </td>
                    {columnas.map(c => <td key={c.titulo} className={c.num ? 'num' : ''}>{c.valor(f)}</td>)}
                    <td>
                      {f.errores?.length > 0 && <div style={{ color: 'var(--error-fuerte)' }}><CircleAlert size={14} aria-hidden="true" /> {f.errores[0]}{f.errores.length > 1 ? ` (+${f.errores.length - 1})` : ''}</div>}
                      {!f.errores?.length && f.avisos?.length > 0 && <div style={{ color: 'var(--alerta)' }}><TriangleAlert size={14} aria-hidden="true" /> {f.avisos[0]}{f.avisos.length > 1 ? ` (+${f.avisos.length - 1})` : ''}</div>}
                      {!f.errores?.length && !f.avisos?.length && f.cambios?.length > 0 && <span>{f.cambios.map(c => c.etiqueta).join(', ')}</span>}
                    </td>
                  </tr>
                  {abierta && (
                    <tr>
                      <td />
                      <td colSpan={columnas.length + 3}>
                        <div className="imp-detalle">
                          {f.errores?.length > 0 && <div><strong>Errores</strong><ul>{f.errores.map((e, i) => <li key={i} style={{ color: 'var(--error-fuerte)' }}>{e}</li>)}</ul></div>}
                          {f.avisos?.length > 0 && <div><strong>Avisos</strong><ul>{f.avisos.map((e, i) => <li key={i}>{e}</li>)}</ul></div>}
                          {f.cambios?.length > 0 && (
                            <div><strong>Qué cambia</strong>
                              <ul>{f.cambios.map((c, i) => <li key={i}>{c.etiqueta || c.campo}: <s>{valorTexto(c.antes)}</s> → <strong>{valorTexto(c.despues)}</strong></li>)}</ul>
                            </div>
                          )}
                          {f.acciones?.length > 0 && (
                            <div><strong>También</strong>
                              <ul>{f.acciones.map((a, i) => (
                                <li key={i}>
                                  {NOMBRE_ENTIDAD[a.entidad] || a.entidad}{a.tipo ? ` ${a.tipo}` : ''}{a.fecha ? ` del ${a.fecha.split('-').reverse().join('/')}` : ''}
                                  {a.peso_kg != null ? ` · ${a.peso_kg} kg` : ''}{a.producto ? ` · ${a.producto}` : ''}
                                  {' — '}{ETIQUETA_ACCION[a.accion]?.texto || a.accion}
                                  {a.accion === 'actualizar' && a.antes != null ? ` (antes ${a.antes} kg)` : ''}
                                </li>
                              ))}</ul>
                            </div>
                          )}
                          {renderExtra && renderExtra(f)}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {paginas > 1 && (
        <nav className="rp-acciones" aria-label="Páginas de la vista previa" style={{ marginTop: 'var(--esp-3)' }}>
          <button type="button" className="btn btn-secondary btn-sm" disabled={pag === 0} onClick={() => setPagina(pag - 1)}>Anterior</button>
          <span>Página {pag + 1} de {paginas} · {visibles.length} filas</span>
          <button type="button" className="btn btn-secondary btn-sm" disabled={pag >= paginas - 1} onClick={() => setPagina(pag + 1)}>Siguiente</button>
        </nav>
      )}
    </div>
  );
}
