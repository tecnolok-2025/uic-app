import { getApiBase, isStandalone } from "../config.js";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

function platformHint() {
  const ua = navigator.userAgent || "";
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  if (!isIOS) return null;
  return "En iPhone: instalá la app (Compartir → Agregar a pantalla de inicio) y abrila desde el ícono. Luego activá Push.";
}

export async function enablePush(preferences = { categories: [] }) {
  const API = getApiBase();
  if (!API) throw new Error("Falta configurar el API (Ajustes → API Base).");
  if (!("serviceWorker" in navigator)) throw new Error("Service Worker no disponible.");
  if (!("PushManager" in window)) throw new Error("Push no disponible en este dispositivo/navegador.");

  const hint = platformHint();
  if (hint && !isStandalone()) {
    throw new Error(hint);
  }

  // Permission
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Permiso de notificaciones no otorgado.");

  const reg = await navigator.serviceWorker.ready;

  const keyRes = await fetch(`${API}/vapid-public-key`);
  if (!keyRes.ok) {
    const txt = await keyRes.text().catch(() => "");
    throw new Error(`No se pudo obtener VAPID public key (${keyRes.status}). ${txt}`);
  }
  const { publicKey } = await keyRes.json();

  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  const subRes = await fetch(`${API}/subscribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription, preferences }),
  });
  if (!subRes.ok) {
    const txt = await subRes.text().catch(() => "");
    throw new Error(`No se pudo registrar suscripción (${subRes.status}). ${txt}`);
  }

  return { ok: true };
}
