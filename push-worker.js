self.addEventListener('push', (event) => {
  const data = event.data?.json();
  if (!data?.title || !data?.body) return;
  event.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    tag: data.tag,
    renotify: true,
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL('./', self.location.href).href;
  event.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const tab = tabs.find((client) => new URL(client.url).pathname === new URL(url).pathname);
    if (tab) await tab.focus();
    else await self.clients.openWindow(url);
  })());
});

