import { useCallback, useEffect, useState } from 'react';
import { Plus, Save, Trash2, ClipboardPaste, CircleAlert, CircleCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../services/api';
import { aviso } from '../../components/ui/avisos';
import Boton from '../../components/ui/Boton';
import { Cargando, EstadoError } from '../../components/ui/Estados';
import { lote2, parsearAretesPegados } from './util';

/*
  Tabla posición → arete del día (viene en el correo de CIISA: «06 → 72ELF»).
  Es la llave que convierte el n.º de deshuese impreso en cajas y primales en un animal.
  Guardar reemplaza la tabla completa de la fecha.
*/
export default function TablaAretes({ fecha, setFecha, canEdit }) {
  const [filas, setFilas] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [pegado, setPegado] = useState('');
  const [errores, setErrores] = useState([]);

  const cargar = useCallback(() => {
    setCargando(true);
    setError(null);
    setErrores([]);
    api.getAretesLote(fecha)
      .then(r => setFilas(r.map(a => ({ posicion: lote2(a.posicion), arete: a.arete, animal_id: a.animal_id, animal_nombre: a.animal_nombre }))))
      .catch(e => setError(e.message))
      .finally(() => setCargando(false));
  }, [fecha]);
  useEffect(() => { cargar(); }, [cargar]);

  const cambiar = (i, campo, valor) => setFilas(fs => fs.map((f, j) => (j === i ? { ...f, [campo]: valor, animal_id: campo === 'arete' ? undefined : f.animal_id } : f)));

  const pegar = () => {
    const { aretes, errores: errs } = parsearAretesPegados(pegado);
    if (!aretes.length) { aviso.error(errs[0] || 'No se reconoció ninguna fila'); return; }
    // Lo pegado manda sobre la misma posición ya digitada.
    setFilas(fs => {
      const mapa = new Map(fs.filter(f => f.posicion || f.arete).map(f => [f.posicion, f]));
      for (const a of aretes) mapa.set(a.posicion, a);
      return [...mapa.values()].sort((a, b) => Number(a.posicion) - Number(b.posicion));
    });
    setPegado('');
    if (errs.length) aviso.info(`${errs.length} línea(s) no se reconocieron`);
  };

  const guardar = async () => {
    setErrores([]);
    setGuardando(true);
    try {
      const aretes = filas.filter(f => f.posicion || f.arete).map(f => ({ posicion: f.posicion, arete: f.arete.trim().toUpperCase() }));
      const r = await api.guardarAretesLote(fecha, aretes);
      aviso.ok(`${r.guardados} arete(s) guardado(s) para el ${fecha.split('-').reverse().join('/')}`);
      if (r.sin_animal.length) aviso.info(`No están en el registro de animales: ${r.sin_animal.join(', ')}`);
      cargar();
    } catch (e) {
      setErrores(e.datos?.detalles?.length ? e.datos.detalles : [e.message]);
    } finally { setGuardando(false); }
  };

  return (
    <div>
      <div className="filter-bar">
        <label htmlFor="rp-fecha-aretes">Fecha del deshuese</label>
        <input id="rp-fecha-aretes" type="date" value={fecha} onChange={e => setFecha(e.target.value)} />
      </div>
      <div className="grid-2">
        <div className="card">
          <h3 className="rp-subtitulo">Posición → arete</h3>
          {cargando && <Cargando />}
          {!cargando && error && <EstadoError mensaje={error} onReintentar={cargar} />}
          {!cargando && !error && (
            <>
              <table className="rp-tabla-edicion">
                <thead><tr><th>Posición</th><th>Arete</th><th>Animal</th>{canEdit && <th><span className="sr-only">Quitar</span></th>}</tr></thead>
                <tbody>
                  {filas.map((f, i) => (
                    <tr key={i}>
                      <td>{canEdit ? <input aria-label={`Posición, fila ${i + 1}`} inputMode="numeric" maxLength={4} value={f.posicion} onChange={e => cambiar(i, 'posicion', e.target.value.replace(/\D/g, ''))} /> : f.posicion}</td>
                      <td>{canEdit ? <input aria-label={`Arete, fila ${i + 1}`} maxLength={10} value={f.arete} onChange={e => cambiar(i, 'arete', e.target.value.toUpperCase())} /> : f.arete}</td>
                      <td>
                        {f.animal_id
                          ? <Link to={`/animales/${f.animal_id}`}><CircleCheck size={14} aria-hidden="true" /> {f.animal_nombre || 'Ver animal'}</Link>
                          : f.animal_id === null ? <span className="rp-tenue"><CircleAlert size={14} aria-hidden="true" /> No está en el registro</span> : <span className="rp-tenue">—</span>}
                      </td>
                      {canEdit && <td><button type="button" className="btn-icon" aria-label={`Quitar posición ${f.posicion || i + 1}`} onClick={() => setFilas(fs => fs.filter((_, j) => j !== i))}><Trash2 size={16} aria-hidden="true" /></button></td>}
                    </tr>
                  ))}
                  {!filas.length && <tr><td colSpan={canEdit ? 4 : 3} className="rp-tenue">No hay tabla de aretes para esta fecha.</td></tr>}
                </tbody>
              </table>
              {canEdit && (
                <div className="rp-acciones" style={{ marginTop: 12 }}>
                  <Boton tamano="sm" icono={Plus} onClick={() => setFilas(fs => [...fs, { posicion: '', arete: '' }])}>Agregar fila</Boton>
                  <Boton variante="primario" icono={Save} cargando={guardando} onClick={guardar}>Guardar tabla del día</Boton>
                </div>
              )}
              {errores.length > 0 && (
                <div className="banner error" role="alert" style={{ marginTop: 12 }}>
                  <CircleAlert size={18} aria-hidden="true" />
                  <ul className="rp-lista-errores">{errores.map((e, i) => <li key={i}>{e}</li>)}</ul>
                </div>
              )}
            </>
          )}
        </div>
        {canEdit && (
          <div className="card">
            <h3 className="rp-subtitulo">Pegar del correo de CIISA</h3>
            <div className="form-group">
              <label htmlFor="rp-pegar-aretes">Una fila por animal: posición y arete</label>
              <textarea id="rp-pegar-aretes" rows={8} value={pegado} onChange={e => setPegado(e.target.value)} placeholder={'06\t72ELF\n07\t26FLB\n08\t49NKB'} />
            </div>
            <Boton icono={ClipboardPaste} onClick={pegar} disabled={!pegado.trim()}>Agregar a la tabla</Boton>
            <p className="rp-nota">Después de agregar, revise y presione «Guardar tabla del día».</p>
          </div>
        )}
      </div>
    </div>
  );
}
