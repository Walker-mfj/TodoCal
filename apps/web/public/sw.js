// Push only: deliberately no fetch handler, offline API cache or write queue.
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
function safeURL(value) {
  try {
    const url = new URL(value || '/', self.location.origin);
    if (url.origin === self.location.origin && url.pathname === '/' && !url.username && !url.password) return url.href;
  } catch {}
  return self.location.origin + '/';
}
self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data?.json() || {}; } catch {}
  event.waitUntil(self.registration.showNotification('TodoCal', {
    body: typeof payload.body === 'string' ? payload.body : 'You have a TodoCal reminder.',
    tag: typeof payload.tag === 'string' ? payload.tag : 'todocal-reminder',
    renotify: false,
    data: {url: safeURL(payload.url)},
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = safeURL(event.notification.data?.url);
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const exact = clients.find(client => client.url === url);
    if (exact) return exact.focus();
    // A new window preserves unsaved drafts in existing tabs; auth gates the app.
    return self.clients.openWindow(url);
  })());
});
