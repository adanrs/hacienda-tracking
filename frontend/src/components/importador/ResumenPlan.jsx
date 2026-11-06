/* Tarjetas de conteo de una vista previa (total, nuevos, se actualizan, sin cambios, errores). */
export default function ResumenPlan({ resumen, extra = [] }) {
  const datos = [
    { etiqueta: 'Filas leídas', valor: resumen.total },
    { etiqueta: 'Nuevos', valor: resumen.nuevos, clase: 'imp-ok' },
    { etiqueta: 'Se actualizan', valor: resumen.actualizados, clase: 'imp-info' },
    { etiqueta: 'Sin cambios', valor: resumen.sin_cambios },
    { etiqueta: 'Con error (no se importan)', valor: resumen.errores, clase: resumen.errores ? 'imp-error' : '' },
    { etiqueta: 'Con avisos', valor: resumen.con_avisos, clase: resumen.con_avisos ? 'imp-alerta' : '' },
    ...extra,
  ];
  return (
    <dl className="imp-resumen">
      {datos.map(d => (
        <div key={d.etiqueta} className={`imp-dato ${d.clase || ''}`}>
          <dt>{d.etiqueta}</dt>
          <dd>{d.valor ?? 0}</dd>
        </div>
      ))}
    </dl>
  );
}
