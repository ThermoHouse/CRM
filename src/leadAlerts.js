const DAY = 86400000;
const HOUR = 3600000;

export const ALERT_RULES = {
  excluded: ['cerrado', 'no'],
  overdueHours: 24,
  abandonedDays: 14,
};

export const FLAG_LABELS = {
  llamada_vencida: 'Llamada vencida (+24 h)',
  abandonado: 'Sin contacto (+14 días)',
  semaforo_abandonado: 'Por rescatar',
};

const timestamp = value => {
  if (!value) return null;
  const dateOnly = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const date = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(value);
  const result = date.getTime();
  return Number.isFinite(result) ? result : null;
};

export function buildAlerts(leads, attempts = [], now = Date.now()) {
  const nowTime = now instanceof Date ? now.getTime() : Number(now);
  const lastAttemptByLead = new Map();

  for (const attempt of attempts) {
    const time = timestamp(attempt.attempted_at);
    if (time === null) continue;
    lastAttemptByLead.set(
      attempt.lead_id,
      Math.max(lastAttemptByLead.get(attempt.lead_id) || 0, time),
    );
  }

  return leads.flatMap(lead => {
    if (ALERT_RULES.excluded.includes(lead.status || 'nuevo')) return [];

    const touchTimes = [
      timestamp(lead.last_contact_at),
      timestamp(lead.fecha_contacto),
      timestamp(lead.created_at),
      lastAttemptByLead.get(lead.id) || null,
    ].filter(time => time !== null);
    const lastTouch = touchTimes.length ? Math.max(...touchTimes) : nowTime;
    const daysSinceTouch = Math.max(0, Math.floor((nowTime - lastTouch) / DAY));
    const flags = [];
    const nextCall = timestamp(lead.next_call_at);

    if (nextCall !== null && nowTime - nextCall >= ALERT_RULES.overdueHours * HOUR) {
      flags.push('llamada_vencida');
    }
    if (daysSinceTouch >= ALERT_RULES.abandonedDays) flags.push('abandonado');
    if (lead.status === 'rescatar') flags.push('semaforo_abandonado');
    if (!flags.length) return [];

    const overdue = flags.includes('llamada_vencida');
    const abandoned = flags.includes('abandonado');
    return [{
      lead,
      flags,
      severity: overdue || abandoned ? 'rojo' : 'naranja',
      daysSinceTouch,
      suggestion: overdue
        ? 'La llamada lleva más de 24 horas vencida: contacta al cliente y registra el intento.'
        : abandoned
          ? 'Este cliente lleva 14 días o más sin contacto: retoma el seguimiento.'
          : 'Este cliente está marcado por rescatar: revisa el siguiente paso de seguimiento.',
    }];
  });
}
