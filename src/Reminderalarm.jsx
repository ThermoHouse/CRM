import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sb } from './supabase';

/*
  Alarmas del CRM
  - Suena (sonido + ventana emergente + notificación del navegador) cuando llega
    la hora de una "Próxima llamada" (leads.next_call_at) o de una cita (leads.appointment_at).
  - Funciona mientras el CRM esté abierto en una pestaña (aunque esté en segundo plano).
  - Cada persona recibe solo SUS alarmas: dueño del lead o vendedor asignado al seguimiento.
  - "Entendido" / "Posponer" se guardan en este navegador (localStorage); si cambias la
    fecha del lead, la alarma se vuelve a armar sola.
*/

const MIN = 60000;
const STORE_KEY = 'crm_alarm_state_v1';
const PREF_KEY = 'crm_alarm_prefs_v1';
const GRACE_MIN = 360; // si abres el CRM tarde, sigue avisando hasta 6 h después de la hora
const advisorKey = value => String(value || '').trim().toLowerCase();

const readJSON = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
};
const writeJSON = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* sin almacenamiento */ }
};

// ---------- Sonido (Web Audio, sin archivos externos) ----------
let audioCtx = null;
const getAudio = () => {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) audioCtx = new Ctx();
  }
  return audioCtx;
};
const unlockAudio = () => {
  const ctx = getAudio();
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
};
function ringOnce() {
  const ctx = getAudio();
  if (!ctx || ctx.state !== 'running') return false;
  const t0 = ctx.currentTime;
  [0, 0.28, 0.56, 0.84].forEach((offset, index) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = index % 2 ? 1175 : 880;
    gain.gain.setValueAtTime(0.0001, t0 + offset);
    gain.gain.exponentialRampToValueAtTime(0.3, t0 + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + 0.22);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0 + offset);
    osc.stop(t0 + offset + 0.25);
  });
  try { navigator.vibrate?.([300, 150, 300]); } catch { /* sin vibración */ }
  return true;
}

const timeLabel = value => new Date(value).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
const dateLabel = value => new Date(value).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
const phoneDigits = value => String(value || '').replace(/[^\d+]/g, '');

const CSS = `
.alarm-fab{position:fixed;right:14px;bottom:14px;z-index:9998;display:flex;flex-direction:column;align-items:flex-end;gap:8px}
.alarm-fab-btn{border:1px solid var(--line);background:var(--card);color:inherit;border-radius:999px;padding:9px 14px;font-weight:600;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25)}
.alarm-fab-btn.ringing{background:#dc2626;color:#fff;border-color:#dc2626;animation:alarm-pulse 1s infinite}
.alarm-panel{width:min(300px,86vw);display:grid;gap:10px;padding:14px;border:1px solid var(--line);border-radius:14px;background:var(--card);box-shadow:0 8px 28px rgba(0,0,0,.3)}
.alarm-panel label{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:13px}
.alarm-panel small{color:var(--mut);font-size:11px;line-height:1.4}
.alarm-overlay{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;padding:16px;background:rgba(0,0,0,.6)}
.alarm-modal{width:min(460px,100%);max-height:88vh;overflow:auto;display:grid;gap:12px;padding:18px;border:2px solid #dc2626;border-radius:16px;background:var(--card);box-shadow:0 20px 60px rgba(0,0,0,.5)}
.alarm-modal h3{margin:0;font-size:18px}
.alarm-item{display:grid;gap:8px;padding:12px;border:1px solid var(--line);border-left:4px solid #dc2626;border-radius:12px}
.alarm-item strong{font-size:16px}
.alarm-item p{margin:0;color:var(--mut);font-size:13px}
.alarm-actions{display:flex;gap:6px;flex-wrap:wrap}
.alarm-actions .btn,.alarm-actions a.btn{text-decoration:none;font-size:13px}
@keyframes alarm-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.07)}}
`;

export default function ReminderAlarm({ userId, userEmail, onOpenLeads }) {
  const [leads, setLeads] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [now, setNow] = useState(Date.now());
  const [state, setState] = useState(() => readJSON(STORE_KEY, {}));
  const [prefs, setPrefs] = useState(() => ({ enabled: true, before: 10, ...readJSON(PREF_KEY, {}) }));
  const [panel, setPanel] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const notified = useRef(new Set());
  const hasAppointmentColumn = useRef(true);

  const updatePrefs = patch => setPrefs(current => {
    const next = { ...current, ...patch };
    writeJSON(PREF_KEY, next);
    return next;
  });
  const updateState = updater => setState(current => {
    const next = updater({ ...current });
    const cutoff = Date.now() - 7 * 86400000;
    Object.keys(next).forEach(key => { if (Number(key.split('|')[2]) < cutoff) delete next[key]; });
    writeJSON(STORE_KEY, next);
    return next;
  });

  // El navegador solo deja sonar audio después de un clic/toque: lo desbloqueamos con el primero.
  useEffect(() => {
    const unlock = () => { if (unlockAudio()?.state === 'running') setAudioReady(true); };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => { window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
  }, []);

  // Reloj
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(id);
  }, []);

  // Carga de leads con llamada o cita cercana
  const load = useCallback(async () => {
    const from = new Date(Date.now() - GRACE_MIN * MIN).toISOString();
    const to = new Date(Date.now() + 3 * 86400000).toISOString();
    const columns = 'id,nombre,whatsapp,ciudad,direccion,asesor,followup_assigned_to,status,next_call_at,appointment_at,appointment_location';
    const legacyColumns = columns.replace(',appointment_at,appointment_location', '');
    const window_ = col => `and(${col}.gte.${from},${col}.lte.${to})`;
    let query = hasAppointmentColumn.current
      ? sb.from('leads').select(columns).or(`${window_('next_call_at')},${window_('appointment_at')}`)
      : sb.from('leads').select(legacyColumns).gte('next_call_at', from).lte('next_call_at', to);
    try {
      let { data, error } = await query.limit(500);
      if (error && hasAppointmentColumn.current && /appointment/i.test(error.message || '')) {
        hasAppointmentColumn.current = false;
        ({ data, error } = await sb.from('leads').select(legacyColumns).gte('next_call_at', from).lte('next_call_at', to).limit(500));
      }
      if (error) {
        setLeads([]);
        setLoadError(error.message || 'No se pudieron consultar los seguimientos.');
        return;
      }
      setLeads(data || []);
      setLoadError('');
    } catch (error) {
      setLeads([]);
      setLoadError(error.message || 'No se pudieron consultar los seguimientos.');
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 60000);
    const onVisible = () => { if (document.visibilityState === 'visible') { load(); setNow(Date.now()); } };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('focus', onVisible); };
  }, [load]);

  // Eventos que me tocan a mí
  const events = useMemo(() => {
    const me = advisorKey(userEmail);
    const list = [];
    for (const lead of leads) {
      if (['cerrado', 'no'].includes(lead.status)) continue;
      const isOwner = advisorKey(lead.asesor) === me;
      const isAssigned = lead.followup_assigned_to === userId;
      // La llamada la atiende quien tiene el seguimiento; si no hay asignado, el dueño.
      const callMine = lead.followup_assigned_to ? isAssigned : isOwner;
      if (lead.next_call_at && callMine) {
        const t = new Date(lead.next_call_at).getTime();
        if (Number.isFinite(t)) list.push({ key: `${lead.id}|call|${t}`, t, kind: 'call', lead });
      }
      if (lead.appointment_at && (isOwner || isAssigned)) {
        const t = new Date(lead.appointment_at).getTime();
        if (Number.isFinite(t)) list.push({ key: `${lead.id}|cita|${t}`, t, kind: 'cita', lead });
      }
    }
    return list;
  }, [leads, userId, userEmail]);

  const due = useMemo(() => prefs.enabled ? events
    .filter(event => {
      const entry = state[event.key] || {};
      if (entry.done) return false;
      if (entry.snoozeUntil && now < entry.snoozeUntil) return false;
      return now >= event.t - prefs.before * MIN && now <= event.t + GRACE_MIN * MIN;
    })
    .sort((a, b) => a.t - b.t) : [], [events, state, now, prefs]);

  // Sonido en bucle + notificación del sistema mientras haya alarmas activas
  useEffect(() => {
    if (!due.length) return undefined;
    const fresh = due.filter(event => !notified.current.has(event.key + (state[event.key]?.snoozeUntil || '')));
    if (fresh.length && 'Notification' in window && Notification.permission === 'granted') {
      fresh.forEach(event => {
        notified.current.add(event.key + (state[event.key]?.snoozeUntil || ''));
        try {
          new Notification(event.kind === 'cita' ? 'Cita con cliente' : 'Llamada de seguimiento', {
            body: `${event.lead.nombre || 'Cliente'} · ${timeLabel(event.t)}`,
            tag: event.key,
            requireInteraction: true,
          });
        } catch { /* algunos móviles no permiten new Notification */ }
      });
    }
    ringOnce();
    const id = setInterval(ringOnce, 4000);
    const originalTitle = document.title;
    let flash = false;
    const titleId = setInterval(() => { flash = !flash; document.title = flash ? `⏰ ${due.length} alarma(s)` : originalTitle; }, 1000);
    return () => { clearInterval(id); clearInterval(titleId); document.title = originalTitle; };
  }, [due, state]);

  const dismiss = event => updateState(current => ({ ...current, [event.key]: { done: true } }));
  const snooze = (event, minutes) => updateState(current => ({ ...current, [event.key]: { snoozeUntil: Date.now() + minutes * MIN } }));
  const dismissAll = () => updateState(current => { due.forEach(event => { current[event.key] = { done: true }; }); return current; });

  const activate = async () => {
    const ctx = unlockAudio();
    if (ctx?.state === 'running') setAudioReady(true);
    ringOnce();
    if ('Notification' in window && Notification.permission === 'default') {
      try { await Notification.requestPermission(); } catch { /* ignorar */ }
    }
  };

  const upcoming = events.filter(event => event.t > now && !(state[event.key] || {}).done).length;

  return (
    <>
      <style>{CSS}</style>

      {due.length > 0 && (
        <div className="alarm-overlay" role="alertdialog" aria-modal="true" aria-label="Alarma de seguimiento">
          <div className="alarm-modal">
            <h3>⏰ {due.length === 1 ? 'Tienes una alarma' : `Tienes ${due.length} alarmas`}</h3>
            {due.map(event => {
              const { lead } = event;
              const phone = phoneDigits(lead.whatsapp);
              const late = now - event.t;
              return (
                <article className="alarm-item" key={event.key}>
                  <strong>{lead.nombre || 'Cliente sin nombre'}</strong>
                  <p>
                    {event.kind === 'cita' ? 'Cita' : 'Llamada de seguimiento'} · {dateLabel(event.t)}
                    {late > MIN ? ` · hace ${Math.round(late / MIN)} min` : late < -MIN ? ` · en ${Math.round(-late / MIN)} min` : ' · ahora'}
                  </p>
                  {event.kind === 'cita' && (lead.appointment_location || lead.direccion) && <p>📍 {lead.appointment_location || lead.direccion}</p>}
                  {phone && <p>📞 {lead.whatsapp}</p>}
                  <div className="alarm-actions">
                    {phone && <a className="btn" href={`tel:${phone}`}>Llamar</a>}
                    {onOpenLeads && <button type="button" className="btn ghost" onClick={() => { dismiss(event); onOpenLeads(lead); }}>Abrir clientes</button>}
                    <button type="button" className="btn ghost" onClick={() => snooze(event, 5)}>Posponer 5 min</button>
                    <button type="button" className="btn ghost" onClick={() => snooze(event, 15)}>15 min</button>
                    <button type="button" className="btn" onClick={() => dismiss(event)}>Entendido</button>
                  </div>
                </article>
              );
            })}
            {due.length > 1 && <button type="button" className="btn ghost" onClick={dismissAll}>Entendido todas</button>}
          </div>
        </div>
      )}

      <div className="alarm-fab">
        {panel && (
          <div className="alarm-panel">
            {loadError && <p className="data-alert" role="alert">No se pudieron cargar las alarmas: {loadError}</p>}
            {!loadError && !hasAppointmentColumn.current && <p className="migration-hint" role="status">Las alarmas de citas no están disponibles. Ejecuta <code>supabase/12_calendar_appointments.sql</code> en Supabase.</p>}
            <label>
              <span>Alarmas activadas</span>
              <input type="checkbox" checked={prefs.enabled} onChange={event => updatePrefs({ enabled: event.target.checked })} />
            </label>
            <label>
              <span>Avisar con anticipación</span>
              <select value={prefs.before} onChange={event => updatePrefs({ before: Number(event.target.value) })}>
                <option value={0}>A la hora exacta</option>
                <option value={5}>5 min antes</option>
                <option value={10}>10 min antes</option>
                <option value={15}>15 min antes</option>
                <option value={30}>30 min antes</option>
                <option value={60}>1 hora antes</option>
              </select>
            </label>
            <button type="button" className="btn" onClick={activate}>{audioReady ? 'Probar sonido' : 'Activar sonido y avisos'}</button>
            <small>
              {upcoming ? `${upcoming} alarma(s) próxima(s) en los siguientes 3 días. ` : 'No tienes alarmas próximas. '}
              Programa una "Próxima llamada" o una cita en el cliente y sonará aquí. Mantén el CRM abierto en una pestaña y el volumen activado.
            </small>
          </div>
        )}
        <button type="button" className={`alarm-fab-btn ${due.length ? 'ringing' : ''}`} onClick={() => { setPanel(open => !open); activate(); }} aria-label={loadError ? 'Error al cargar las alarmas del CRM' : 'Alarmas del CRM'} title={loadError || 'Alarmas del CRM'}>
          {prefs.enabled ? '🔔' : '🔕'} {upcoming > 0 ? upcoming : ''}
        </button>
      </div>
    </>
  );
}