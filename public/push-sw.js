self.addEventListener('push', event => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data?.text() || 'Tienes un seguimiento pendiente.' };
  }

  const title = payload.title || 'Recordatorio del CRM';
  const scheduledAt = payload.scheduled_at
    ? new Date(payload.scheduled_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
    : '';
  const options = {
    body: [payload.body || 'Tienes un seguimiento pendiente.', scheduledAt].filter(Boolean).join(' · '),
    tag: payload.tag || 'crm-lead-reminder',
    renotify: true,
    requireInteraction: true,
    data: { url: payload.url || '/' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const requestedUrl = new URL(event.notification.data?.url || '/', self.location.origin);
  const targetUrl = requestedUrl.origin === self.location.origin
    ? requestedUrl.href
    : self.location.origin;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
        await client.focus();
        return;
      }
    }
    await self.clients.openWindow(targetUrl);
  })());
});
