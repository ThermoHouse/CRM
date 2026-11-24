import { useEffect, useMemo, useState } from 'react';
import { sb } from './supabase';
import { buildAlerts, ALERT_RULES, FLAG_LABELS } from './leadAlerts';

// Pantalla "Hoy" para el rol Ventas: lo que toca hacer ahora, sin filtros ni tablas de números.
// Usa las mismas reglas que Alertas (leadAlerts.js), así los contadores coinciden con la pestaña Alertas de Leads.

const COLORS = { rojo: '#ef6b6b', naranja: '#f0a24f', amarillo: '#e6c35c' };
const DAY = 86400000;
const phone10 = v => String(v || '').replace(/\D/g, '').slice(-10);
const sameDay = (iso, now) => !!iso && new Date(iso).toDateString() === new Date(now).toDateString();
const hhmm = iso => new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
const PAGE = 10;

const CSS = `
.hoy{max-width:720px;margin:0 auto;display:grid;gap:20px;padding-bottom:24px}
.hoy-head{display:grid;gap:4px}
.hoy-head h2{margin:0;font-size:1.8rem;line-height:1.1}
.hoy-counters{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.hoy-counter{border:1px solid var(--line);border-radius:var(--r-lg,14px);padding:16px 10px;text-align:center;cursor:pointer;background:var(--card2,rgba(127,127,127,.06));color:inherit;font:inherit;transition:transform .15s ease,border-color .2s ease,background .2s ease,box-shadow .2s ease}
.hoy-counter:hover{transform:translateY(-1px);border-color:color-mix(in srgb,var(--c,var(--line)) 45%,var(--line))}
.hoy-counter b{display:block;font-size:2rem;line-height:1.05}
.hoy-counter span{display:block;margin-top:4px;font-size:12px;color:var(--mut,#9aa4b2)}
.hoy-counter.on{border-color:color-mix(in srgb,var(--c) 55%,var(--line));background:color-mix(in srgb,var(--c) 12%,transparent);box-shadow:0 0 0 1px color-mix(in srgb,var(--c) 18%,transparent) inset}
.hoy-list{display:grid;gap:14px}
.hoy-item{border:1px solid var(--line);border-left:4px solid color-mix(in srgb,var(--c) 70%,var(--line));padding:16px;border-radius:var(--r-lg,14px);background:var(--card,rgba(127,127,127,.06));display:grid;gap:10px;transition:border-color .2s ease,background .2s ease}
.hoy-item.done{opacity:.72}
.hoy-top{display:flex;flex-wrap:wrap;justify-content:space-between;gap:6px 12px;align-items:baseline}
.hoy-top strong{font-size:1.02rem}
.hoy-why{display:flex;flex-wrap:wrap;gap:6px}
.hoy-tip{font-size:13px;color:var(--mut,#9aa4b2);line-height:1.45}
.hoy-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:2px}
.hoy-actions a,.hoy-actions button{min-height:42px;display:inline-flex;align-items:center;justify-content:center;text-align:center;text-decoration:none;border-radius:12px;font-weight:600;font-size:14px;border:1px solid var(--line);cursor:pointer;font-family:inherit;transition:background .2s ease,border-color .2s ease,color .2s ease,transform .15s ease}
.hoy-actions a:hover,.hoy-actions button:hover:not(:disabled){transform:translateY(-1px)}
.hoy-actions .hoy-call{background:rgba(99,102,241,.14);color:#c7d2fe;border-color:rgba(99,102,241,.35)}
.hoy-actions .hoy-wa{background:rgba(34,197,94,.12);color:#bbf7d0;border-color:rgba(34,197,94,.32)}
.hoy-actions .hoy-register{grid-column:1/-1;background:color-mix(in srgb,var(--c,#64748b) 14%,transparent);color:inherit;border-color:color-mix(in srgb,var(--c,#64748b) 38%,var(--line))}
.hoy-actions .hoy-register:disabled{opacity:.7;cursor:default;transform:none}
.hoy-actions .hoy-disabled{opacity:.55;cursor:default;justify-content:center}
.hoy-link{justify-self:start;background:transparent;border:none;color:var(--mut,#9aa4b2);font:inherit;font-size:13px;font-weight:500;text-decoration:underline;text-decoration-color:color-mix(in srgb,var(--mut,#9aa4b2) 45%,transparent);text-underline-offset:3px;padding:2px 0;cursor:pointer}
.hoy-link:hover{color:inherit}
@media(max-width:520px){.hoy-counters{grid-template-columns:repeat(3,1fr);gap:8px}.hoy-counter{padding:12px 6px}.hoy-counter b{font-size:1.6rem}}
`;

export default function SalesToday({ leads, statusLabels = {}, onOpen }) {
  const [attempts, setAttempts] = useState([]);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [done, setDone] = useState({}); // lead_id -> true (registrado en esta sesión)
  const [busyId, setBusyId] = useState(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(id); }, []);

  useEffect(() => {
    let alive = true;
    sb.from('lead_contact_attempts').select('lead_id,attempted_at').order('attempted_at', { ascending: false }).limit(5000)
      .then(({ data, error: e }) => { if (!alive) return; if (e) setError(e.message); else setAttempts(data || []); });
    return () => { alive = false; };
  }, []);

  const { items, counts } = useMemo(() => {
    const alerts = buildAlerts(leads, attempts, now);
    const byId = new Map(alerts.map(a => [a.lead.id, a]));
    const lastAttempt = new Map();
    for (const a of attempts) { const v = new Date(a.attempted_at).getTime(); if (v > (lastAttempt.get(a.lead_id) || 0)) lastAttempt.set(a.lead_id, v); }

    // Llamadas programadas para hoy (aunque no tengan alerta)
    for (const lead of leads) {
      const status = lead.status || 'nuevo';
      if (ALERT_RULES.excluded.includes(status)) continue;
      if (!sameDay(lead.next_call_at, now)) continue;
      const entry = byId.get(lead.id);
      if (entry) { entry.today = true; continue; }
      const touch = Math.max(lastAttempt.get(lead.id) || 0, lead.last_contact_at ? new Date(lead.last_contact_at).getTime() : 0, lead.created_at ? new Date(lead.created_at).getTime() : 0);
      byId.set(lead.id, { lead, flags: [], severity: 'amarillo', daysSinceTouch: Math.floor((now - touch) / DAY), suggestion: 'Tienes llamada agendada hoy: hazla y registra el intento.', today: true });
    }

    const all = [...byId.values()];
    const rank = a => a.flags.includes('llamada_vencida') ? 0 : a.today ? 1 : a.flags.includes('abandonado') ? 2 : a.flags.includes('semaforo_abandonado') ? 3 : 4;
    all.sort((a, b) => rank(a) - rank(b) || (rank(a) === 1 ? new Date(a.lead.next_call_at) - new Date(b.lead.next_call_at) : b.daysSinceTouch - a.daysSinceTouch));

    return {
      items: all,
      counts: {
        hoy: all.filter(a => a.today).length,
        vencidas: all.filter(a => a.flags.includes('llamada_vencida')).length,
        abandonados: all.filter(a => a.flags.includes('abandonado')).length,
      },
    };
  }, [leads, attempts, now]);

  const matches = {
    hoy: a => a.today,
    vencidas: a => a.flags.includes('llamada_vencida'),
    abandonados: a => a.flags.includes('abandonado'),
  };
  const filtered = filter ? items.filter(matches[filter]) : items;
  // Los ya registrados en esta sesión pasan al final
  const ordered = [...filtered.filter(a => !done[a.lead.id]), ...filtered.filter(a => done[a.lead.id])];
  const shown = showAll ? ordered : ordered.slice(0, PAGE);

  const register = async (lead, method) => {
    setBusyId(lead.id); setError('');
    const { data, error: e } = await sb.from('lead_contact_attempts').insert({ lead_id: lead.id, method })
      .select('id,lead_id,method,attempted_at').single();
    setBusyId(null);
    if (e) { setError(e.message || 'No se pudo registrar el intento.'); return false; }
    setAttempts(cur => [data, ...cur]);
    setDone(cur => ({ ...cur, [lead.id]: true }));
    return true;
  };

  const counter = (key, label, accent) => (
    <button type="button" className={`hoy-counter ${filter === key ? 'on' : ''}`} aria-pressed={filter === key}
      onClick={() => { setFilter(filter === key ? '' : key); setShowAll(false); }}
      style={{ '--c': accent }}>
      <b style={{ color: accent }}>{counts[key]}</b><span>{label}</span>
    </button>
  );

  return (
    <div className="hoy">
      <style>{CSS}</style>
      <div className="hoy-head">
        <span className="lbl">{new Date(now).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
        <h2>Hoy</h2>
      </div>

      <div className="hoy-counters">
        {counter('hoy', 'Llamadas de hoy', '#a5b4fc')}
        {counter('vencidas', 'Vencidas', COLORS.naranja)}
        {counter('abandonados', 'Abandonados', COLORS.rojo)}
      </div>

      {error && <p className="data-alert" role="alert">{error}</p>}
      {!ordered.length && <p className="mut">{filter ? 'Nada en esta lista.' : 'Todo al día. No hay seguimientos urgentes.'}</p>}

      <div className="hoy-list">
        {shown.map(a => {
          const { lead } = a;
          const isDone = !!done[lead.id];
          const tel = phone10(lead.whatsapp);
          const color = COLORS[a.severity] || COLORS.amarillo;
          return (
            <article key={lead.id} className={`hoy-item ${isDone ? 'done' : ''}`} style={{ '--c': color }}>
              <div className="hoy-top">
                <strong>{lead.nombre || 'Cliente sin nombre'}{lead.folio ? ` · ${lead.folio}` : ''}</strong>
                <span className="mut">{statusLabels[lead.status] || lead.status} · {a.daysSinceTouch} d sin contacto</span>
              </div>
              <div className="hoy-why">
                {a.today && <span className="pill">Llamar a las {hhmm(lead.next_call_at)}</span>}
                {a.flags.map(f => <span key={f} className="pill">{FLAG_LABELS[f]}</span>)}
              </div>
              <div className="hoy-tip">💡 {a.suggestion}</div>
              <div className="hoy-actions">
                {tel ? <a className="hoy-call" href={`tel:+52${tel}`}>Llamar</a> : <span className="mut hoy-disabled">Sin teléfono</span>}
                {tel && <a className="hoy-wa" href={`https://web.whatsapp.com/send?phone=52${tel}`} target="_blank" rel="noopener noreferrer" onClick={() => { if (!isDone) register(lead, 'whatsapp'); }}>WhatsApp</a>}
                <button type="button" className="hoy-register" disabled={busyId === lead.id || isDone} onClick={() => register(lead, 'llamada')}>
                  {isDone ? '✓ Registrado' : busyId === lead.id ? 'Guardando…' : 'Registrar intento'}
                </button>
              </div>
              {onOpen && <button type="button" className="hoy-link" onClick={() => onOpen(lead)}>Abrir lead</button>}
            </article>
          );
        })}
      </div>

      {ordered.length > PAGE && (
        <button type="button" className="btn ghost" style={{ minHeight: 48 }} onClick={() => setShowAll(v => !v)}>
          {showAll ? 'Ver solo los más urgentes' : `Ver todos (${ordered.length})`}
        </button>
      )}
    </div>
  );
}
