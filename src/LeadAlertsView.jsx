import { useEffect, useMemo, useState } from 'react';
import { sb } from './supabase';
import { buildAlerts, FLAG_LABELS } from './leadAlerts';

const COLORS = { rojo: '#dc2626', naranja: '#ea580c' };
const formatDate = value => value
  ? new Date(value).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })
  : '';

const CSS = `
.lead-alerts{display:grid;gap:12px}
.lead-alerts-counts{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.lead-alerts-count{display:grid;gap:4px;padding:12px;border:1px solid var(--line);border-radius:12px;background:var(--card)}
.lead-alerts-count strong{font-size:24px}
.lead-alerts-list{display:grid;gap:10px}
.lead-alert-item{display:grid;gap:8px;padding:14px;border:1px solid var(--line);border-left:4px solid var(--alert-color);border-radius:12px;background:var(--card)}
.lead-alert-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap}
.lead-alert-flags{display:flex;gap:6px;flex-wrap:wrap}
.lead-alert-flags .pill{color:var(--alert-color)}
.lead-alert-item p{margin:0;color:var(--mut);font-size:12px}
.lead-alert-item .btn{justify-self:start}
`;

export default function LeadAlertsView({ leads = [], statusLabels = {}, onEdit }) {
  const [attempts, setAttempts] = useState([]);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let active = true;
    sb.from('lead_contact_attempts')
      .select('lead_id,attempted_at')
      .order('attempted_at', { ascending: false })
      .limit(5000)
      .then(({ data, error: requestError }) => {
        if (!active) return;
        if (requestError) setError(requestError.message);
        else setAttempts(data || []);
      });
    return () => { active = false; };
  }, []);

  const alerts = useMemo(
    () => buildAlerts(leads, attempts, now).sort((a, b) => {
      const priority = item => item.flags.includes('llamada_vencida') ? 0
        : item.flags.includes('abandonado') ? 1 : 2;
      return priority(a) - priority(b) || b.daysSinceTouch - a.daysSinceTouch;
    }),
    [leads, attempts, now],
  );
  const counts = {
    llamada_vencida: alerts.filter(item => item.flags.includes('llamada_vencida')).length,
    abandonado: alerts.filter(item => item.flags.includes('abandonado')).length,
    semaforo_abandonado: alerts.filter(item => item.flags.includes('semaforo_abandonado')).length,
  };

  return (
    <section className="lead-alerts">
      <style>{CSS}</style>
      <div className="lead-alerts-counts" aria-label="Resumen de alertas">
        <div className="lead-alerts-count"><span className="mut">Llamadas vencidas</span><strong>{counts.llamada_vencida}</strong></div>
        <div className="lead-alerts-count"><span className="mut">Sin contacto (+14 días)</span><strong>{counts.abandonado}</strong></div>
        <div className="lead-alerts-count"><span className="mut">Por rescatar</span><strong>{counts.semaforo_abandonado}</strong></div>
      </div>
      {error && <p className="data-alert" role="alert">No se pudieron cargar los intentos de contacto: {error}</p>}
      {!alerts.length
        ? <p className="mut">No hay clientes con alertas de seguimiento.</p>
        : <div className="lead-alerts-list">
          {alerts.map(({ lead, flags, severity, daysSinceTouch, suggestion }) => (
            <article className="lead-alert-item" key={lead.id} style={{ '--alert-color': COLORS[severity] }}>
              <div className="lead-alert-heading">
                <strong>{lead.nombre || 'Cliente sin nombre'}{lead.folio ? ` · ${lead.folio}` : ''}</strong>
                <div className="lead-alert-flags">
                  {flags.map(flag => <span className="pill" key={flag}>{FLAG_LABELS[flag]}</span>)}
                </div>
              </div>
              <p>{statusLabels[lead.status] || lead.status || 'Nuevo'} · {daysSinceTouch} d sin contacto</p>
              {lead.next_call_at && flags.includes('llamada_vencida') && <p>Seguimiento programado: {formatDate(lead.next_call_at)}</p>}
              <p>{suggestion}</p>
              {onEdit && <button type="button" className="btn ghost" onClick={() => onEdit(lead)}>Abrir lead</button>}
            </article>
          ))}
        </div>}
    </section>
  );
}
