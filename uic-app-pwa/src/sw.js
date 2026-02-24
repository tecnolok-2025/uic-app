/* Custom Service Worker for UIC PWA (push + offline handled by Workbox runtime). */
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const title = data.title || "UIC Campana";
  const options = {
    body: data.body || "Nueva notificación",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: data.data || { url: "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification?.data?.url || "/";
  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of allClients) {
      if ("focus" in c) {
        c.focus();
        try { c.navigate(target); } catch {}
        return;
      }
    }
    if (clients.openWindow) return clients.openWindow(target);
  })());
});
