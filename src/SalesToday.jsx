import { useEffect, useMemo, useState } from 'react';
import { sb } from './supabase';
import { buildAlerts, ALERT_RULES, FLAG_LABELS } from './leadAlerts';

// Pantalla "Hoy" para el rol Ventas: lo que toca hacer ahora, sin filtros ni tablas de números.
// Usa las mismas reglas que Alertas (leadAlerts.js), así los contadores coinciden con la pestaña Alertas de Leads.

const COLORS = { rojo: '#dc2626', naranja: '#ea580c', amarillo: '#ca8a04' };
const DAY = 86400000;
const phone10 = v => String(v || '').replace(/\D/g, '').slice(-10);
const sameDay = (iso, now) => !!iso && new Date(iso).toDateString() === new Date(now).toDateString();
const hhmm = iso => new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
const PAGE = 10;

const CSS = `
.hoy{max-width:640px;margin:0 auto;display:grid;gap:16px;padding-bottom:24px}
.hoy-header{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}
.hoy-counters{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.hoy-counter{border:2px solid transparent;border-radius:var(--r-md);padding:14px 8px;text-align:center;cursor:pointer;background:rgba(127,127,127,.08);color:inherit;font:inherit}
.hoy-counter b{display:block;font-size:2rem;line-height:1.1}
.hoy-counter span{font-size:12px;opacity:.85}
.hoy-counter.active{border-color:var(--c);background:color-mix(in srgb,var(--c) 18%,transparent)}
.hoy-list{display:grid;gap:10px}
.hoy-item{border-left:5px solid var(--c);padding:10px 12px;border-radius:var(--r-sm);background:rgba(127,127,127,.08);display:grid;gap:4px}
.hoy-name{font-size:1rem}
.hoy-meta{font-size:13px;opacity:.85}
.hoy-reason{font-size:13px}
.hoy-miss{font-size:12px;opacity:.75}
.hoy-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:4px}
.hoy-actions a,.hoy-actions button{min-height:48px;display:flex;align-items:center;justify-content:center;text-align:center;text-decoration:none;border-radius:var(--r-md);font-weight:800;font-size:14px;border:0;cursor:pointer;font-family:inherit}
.hoy-call{background:#2563eb;color:#fff}
.hoy-wa{background:#16a34a;color:#fff}
.hoy-done{background:#0f766e;color:#fff;grid-column:1/-1}
.hoy-undo{background:transparent;color:inherit;border:1px solid rgba(127,127,127,.45)!important;font-size:13px}
.hoy-empty{text-align:center;padding:28px 12px;opacity:.85}
.hoy-empty b{display:block;font-size:1.15rem;margin-bottom:6px}
@media(max-width:420px){.hoy-counters{grid-template-columns:1fr 1fr 1fr}.hoy-counter b{font-size:1.6rem}}
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

  const counter = (key, label) => (
    <button type="button" className={`hoy-counter ${filter === key ? 'on' : ''}`} aria-pressed={filter === key}
      onClick={() => { setFilter(filter === key ? '' : key); setShowAll(false); }}
      style={{ color: key === 'hoy' ? undefined : COLORS.rojo }}>
      <b>{counts[key]}</b><span style={{ color: 'inherit' }}>{label}</span>
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
        {counter('hoy', 'Llamadas de hoy')}
        {counter('vencidas', 'Vencidas')}
        {counter('abandonados', 'Abandonados')}
      </div>

      {error && <p className="data-alert" role="alert">{error}</p>}
      {!ordered.length && <p className="mut">{filter ? 'Nada en esta lista.' : 'Todo al día. No hay seguimientos urgentes.'}</p>}

      <div className="hoy-list">
        {shown.map(a => {
          const { lead } = a;
          const isDone = !!done[lead.id];
          const tel = phone10(lead.whatsapp);
          const color = COLORS[a.severity];
          return (
            <div key={lead.id} className={`hoy-item ${isDone ? 'done' : ''}`} style={{ '--c': color }}>
              <div className="hoy-top">
                <strong>{lead.nombre || 'Cliente sin nombre'}{lead.folio ? ` · ${lead.folio}` : ''}</strong>
                <span className="mut">{statusLabels[lead.status] || lead.status} · {a.daysSinceTouch} d sin contacto</span>
              </div>
              <div className="hoy-why">
                {a.today && <span className="pill">Llamar a las {hhmm(lead.next_call_at)}</span>}
                {a.flags.map(f => <span key={f} className="pill">{FLAG_LABELS[f]}</span>)}
              </div>
              <div>💡 {a.suggestion}</div>
              <div className="hoy-actions">
                {tel ? <a className="primary" href={`tel:+52${tel}`}>Llamar</a> : <span className="mut" style={{ alignSelf: 'center' }}>Sin teléfono</span>}
                {tel && <a href={`https://web.whatsapp.com/send?phone=52${tel}`} target="_blank" rel="noopener noreferrer" onClick={() => { if (!isDone) register(lead, 'whatsapp'); }}>WhatsApp</a>}
                <button type="button" disabled={busyId === lead.id || isDone} onClick={() => register(lead, 'llamada')}>
                  {isDone ? '✓ Registrado' : busyId === lead.id ? 'Guardando…' : 'Registrar intento'}
                </button>
              </div>
              {onOpen && <button type="button" className="hoy-link" onClick={() => onOpen(lead)}>Abrir lead</button>}
            </div>
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
