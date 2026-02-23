const API = import.meta.env.VITE_API_BASE;

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export async function enablePush(preferences = { categories: [] }) {
  if (!API) throw new Error("Falta VITE_API_BASE (.env)");
  if (!("serviceWorker" in navigator)) throw new Error("Service Worker no disponible");
  if (!("PushManager" in window)) throw new Error("PushManager no disponible");

  const reg = await navigator.serviceWorker.ready;

  const keyRes = await fetch(`${API}/vapid-public-key`);
  if (!keyRes.ok) throw new Error("No se pudo obtener VAPID public key");
  const { publicKey } = await keyRes.json();

  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  const res = await fetch(`${API}/subscribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription, preferences }),
  });

  if (!res.ok) throw new Error("Falló subscribe");
  return true;
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) await sub.unsubscribe();
  return true;
}
