import {useEffect, useMemo, useState} from 'react';
import {sb} from './supabase';
import {ConfirmDialog} from './ui';

const todayInput = () => {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const num = v => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const fmt = v => Number(v || 0).toLocaleString('es-MX', {maximumFractionDigits: 2});
const showDate = v => (v ? String(v).slice(0, 10) : '—');

const emptyForm = nextNumero => ({
  numero: nextNumero || 1,
  fecha: todayInput(),
  inventario_inicial: 0,
  entrada_cubetas: 0,
  salida_cubetas: 0,
  inventario_final: 0,
  comentario: '',
});

export default function ImpermeabilizanteControl({canEdit = false, isRoot = false}) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [missingTable, setMissingTable] = useState(false);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);

  const load = async () => {
    setLoading(true);
    setError('');
    const {data, error: loadError} = await sb
      .from('impermeabilizante_movimientos')
      .select('*')
      .order('fecha', {ascending: false})
      .order('numero', {ascending: false})
      .order('created_at', {ascending: false});
    if (loadError) {
      const msg = loadError.message || 'No se pudieron cargar los movimientos.';
      const missing = loadError.code === '42P01' || /relation .* does not exist/i.test(msg) || /impermeabilizante_movimientos/i.test(msg) && /schema cache|not find|does not exist/i.test(msg);
      setMissingTable(missing);
      setError(missing ? '' : msg);
      setRows([]);
    } else {
      setMissingTable(false);
      setRows(data || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const nextNumero = useMemo(() => (rows.reduce((m, r) => Math.max(m, Number(r.numero) || 0), 0) || 0) + 1, [rows]);

  const openNew = () => {
    setError('');
    setForm(emptyForm(nextNumero));
  };
  const openEdit = row => {
    setError('');
    setForm({
      id: row.id,
      numero: row.numero ?? '',
      fecha: row.fecha || todayInput(),
      inventario_inicial: row.inventario_inicial ?? 0,
      entrada_cubetas: row.entrada_cubetas ?? 0,
      salida_cubetas: row.salida_cubetas ?? 0,
      inventario_final: row.inventario_final ?? 0,
      comentario: row.comentario || '',
    });
  };

  const set = key => event => {
    const value = event.target.value;
    setForm(current => {
      const next = {...current, [key]: value};
      if (['inventario_inicial', 'entrada_cubetas', 'salida_cubetas'].includes(key)) {
        const inicial = num(key === 'inventario_inicial' ? value : next.inventario_inicial);
        const entrada = num(key === 'entrada_cubetas' ? value : next.entrada_cubetas);
        const salida = num(key === 'salida_cubetas' ? value : next.salida_cubetas);
        next.inventario_final = Number((inicial + entrada - salida).toFixed(2));
      }
      return next;
    });
  };

  const save = async event => {
    event.preventDefault();
    if (!form) return;
    setBusy(true);
    setError('');
    try {
      const payload = {
        numero: Math.max(1, parseInt(form.numero, 10) || 1),
        fecha: form.fecha || todayInput(),
        inventario_inicial: num(form.inventario_inicial),
        entrada_cubetas: num(form.entrada_cubetas),
        salida_cubetas: num(form.salida_cubetas),
        inventario_final: num(form.inventario_final),
        comentario: (form.comentario || '').trim() || null,
      };
      const {error: saveError} = form.id
        ? await sb.from('impermeabilizante_movimientos').update(payload).eq('id', form.id)
        : await sb.from('impermeabilizante_movimientos').insert(payload);
      if (saveError) throw saveError;
      setForm(null);
      await load();
    } catch (err) {
      setError(err.message || 'No se pudo guardar el movimiento.');
    } finally {
      setBusy(false);
    }
  };

  const confirmRemove = async () => {
    if (!pendingDelete) return;
    setBusy(true);
    setError('');
    try {
      const {error: delError} = await sb.from('impermeabilizante_movimientos').delete().eq('id', pendingDelete.id);
      if (delError) throw delError;
      setPendingDelete(null);
      await load();
    } catch (err) {
      setError(err.message || 'No se pudo eliminar el movimiento.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card tbl">
      <div className="row">
        <div style={{flex: 1}}>
          <span className="lbl">Inventario</span>
          <h3>Impermeabilizante · control de entradas y salidas</h3>
        </div>
        {canEdit && !missingTable && (
          <button type="button" className="btn" onClick={openNew}>+ Movimiento</button>
        )}
      </div>
      <p className="mut">Registro en cubetas: inventario inicial, entradas, salidas e inventario final/resumido por movimiento.</p>
      {loading && <p className="mut">Cargando movimientos…</p>}
      {missingTable && isRoot && (
        <p className="migration-hint" role="status">
          Para habilitar este control ejecuta <code>supabase/47_impermeabilizante_movimientos.sql</code> en Supabase.
        </p>
      )}
      {missingTable && !isRoot && !loading && (
        <p className="mut">El control de impermeabilizante no está disponible en este momento.</p>
      )}
      {error && <p className="data-alert" role="alert">{error}</p>}
      {!loading && !missingTable && rows.length === 0 && <p className="mut">No hay movimientos registrados.</p>}
      {!missingTable && rows.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Número</th>
              <th>Fecha</th>
              <th>Inventario inicial</th>
              <th>Entrada (cubetas)</th>
              <th>Salidas (cubetas)</th>
              <th>Inventario final / resumido</th>
              <th>Comentario</th>
              {canEdit && <th>Acciones</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.id}>
                <td>{row.numero}</td>
                <td>{showDate(row.fecha)}</td>
                <td>{fmt(row.inventario_inicial)}</td>
                <td className="amount-in">+{fmt(row.entrada_cubetas)}</td>
                <td className="amount-out">-{fmt(row.salida_cubetas)}</td>
                <td><strong>{fmt(row.inventario_final)}</strong></td>
                <td>{row.comentario || '—'}</td>
                {canEdit && (
                  <td>
                    <button type="button" className="btn ghost" disabled={busy} onClick={() => openEdit(row)}>Editar</button>{' '}
                    <button type="button" className="btn red" disabled={busy} onClick={() => setPendingDelete(row)}>Eliminar</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {form && (
        <div className="modal">
          <form className="card appointment-form" onSubmit={save}>
            <div className="row">
              <h3 style={{flex: 1}}>{form.id ? 'Editar movimiento' : 'Nuevo movimiento de impermeabilizante'}</h3>
              <button type="button" className="btn ghost" disabled={busy} onClick={() => setForm(null)}>✕</button>
            </div>
            <label htmlFor="imp-numero">Número</label>
            <input id="imp-numero" type="number" min="1" step="1" required value={form.numero} onChange={set('numero')} />
            <label htmlFor="imp-fecha">Fecha</label>
            <input id="imp-fecha" type="date" required value={form.fecha} onChange={set('fecha')} />
            <label htmlFor="imp-inicial">Inventario inicial (cubetas)</label>
            <input id="imp-inicial" type="number" min="0" step="0.01" required value={form.inventario_inicial} onChange={set('inventario_inicial')} />
            <label htmlFor="imp-entrada">Entrada (número de cubetas)</label>
            <input id="imp-entrada" type="number" min="0" step="0.01" required value={form.entrada_cubetas} onChange={set('entrada_cubetas')} />
            <label htmlFor="imp-salida">Salida (número de cubetas)</label>
            <input id="imp-salida" type="number" min="0" step="0.01" required value={form.salida_cubetas} onChange={set('salida_cubetas')} />
            <label htmlFor="imp-final">Inventario final / resumido (cubetas)</label>
            <input id="imp-final" type="number" step="0.01" required value={form.inventario_final} onChange={set('inventario_final')} />
            <small className="field-hint">Se calcula como inicial + entradas − salidas; puedes ajustarlo si lo necesitas.</small>
            <label htmlFor="imp-comentario">Comentario</label>
            <textarea id="imp-comentario" maxLength={500} value={form.comentario} onChange={set('comentario')} />
            <div className="row">
              <button className="btn" type="submit" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
              <button className="btn ghost" type="button" disabled={busy} onClick={() => setForm(null)}>Cancelar</button>
            </div>
          </form>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Eliminar movimiento"
        message={pendingDelete ? `¿Eliminar el movimiento #${pendingDelete.numero} del ${showDate(pendingDelete.fecha)}?` : ''}
        confirmLabel="Eliminar"
        tone="danger"
        busy={busy}
        onConfirm={confirmRemove}
        onCancel={() => { if (!busy) setPendingDelete(null); }}
      />
    </div>
  );
}
