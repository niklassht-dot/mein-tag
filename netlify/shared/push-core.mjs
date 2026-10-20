/* ==========================================================
   Gemeinsame Push-Logik für /api/push und den täglichen Versand.
   - VAPID-Schlüssel werden beim ersten Aufruf automatisch erzeugt
     und privat in Netlify Blobs gespeichert (keine Einrichtung nötig).
   - Abos (Handys/Browser) liegen ebenfalls in Netlify Blobs.
   ========================================================== */

import { getStore } from "@netlify/blobs";
import webpush from "web-push";
import { createHash, timingSafeEqual } from "node:crypto";

const PUSH_STORE = "mein-tag-push";
const VAPID_KEY = "vapid";
const SUBS_KEY = "subscriptions";


export const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });

const sha = (v) => createHash("sha256").update(String(v)).digest();

export function pinIsValid(provided) {
  const expected = process.env.LIFE_PIN || "2109";
  return Boolean(provided) && timingSafeEqual(sha(provided), sha(expected));
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function pushStore() {
  return getStore({ name: PUSH_STORE, consistency: "strong" });
}

/** VAPID-Schlüssel laden oder einmalig erzeugen. */
export async function getVapidKeys() {
  const s = pushStore();
  let keys = await s.get(VAPID_KEY, { type: "json" });
  if (keys && keys.publicKey && keys.privateKey) return keys;
  const fresh = webpush.generateVAPIDKeys();
  const write = await s.setJSON(VAPID_KEY, fresh, { onlyIfNew: true });
  if (write.modified === false) keys = await s.get(VAPID_KEY, { type: "json" });
  return keys && keys.publicKey ? keys : fresh;
}

const subId = (endpoint) => createHash("sha256").update(endpoint).digest("hex").slice(0, 32);

export async function listSubscriptions() {
  const data = await pushStore().get(SUBS_KEY, { type: "json" });
  return data && typeof data === "object" ? data : {};
}

/** Atomare Änderung der Abo-Liste. */
async function mutateSubscriptions(fn) {
  const s = pushStore();
  for (let i = 0; i < 10; i++) {
    const entry = await s.getWithMetadata(SUBS_KEY, { type: "json" });
    const current = (entry && entry.data) || {};
    const next = fn({ ...current });
    const options = entry ? { onlyIfMatch: entry.etag } : { onlyIfNew: true };
    const write = await s.setJSON(SUBS_KEY, next, options);
    if (write.modified !== false) return next;
    await sleep(30 + Math.random() * 100);
  }
  throw new Error("subscriptions busy");
}

export function isValidSubscription(sub) {
  return Boolean(
    sub && typeof sub.endpoint === "string" && /^https:\/\//.test(sub.endpoint) &&
    sub.keys && typeof sub.keys.p256dh === "string" && typeof sub.keys.auth === "string"
  );
}

export async function saveSubscription(sub, device = "") {
  const id = subId(sub.endpoint);
  await mutateSubscriptions((all) => {
    all[id] = {
      subscription: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
      device: String(device).slice(0, 120),
      createdAt: (all[id] && all[id].createdAt) || new Date().toISOString()
    };
    return all;
  });
  return id;
}

export async function removeSubscriptions(endpoints) {
  const ids = new Set(endpoints.map(subId));
  if (!ids.size) return;
  await mutateSubscriptions((all) => {
    ids.forEach((id) => delete all[id]);
    return all;
  });
}

function vapidSubject() {
  const site = process.env.URL || "https://example.netlify.app";
  return site.startsWith("https://") ? site : "https://example.netlify.app";
}

/**
 * Nachricht an Abos senden.
 * payload: { title, body, url, tag }
 * Abgelaufene Abos (404/410) werden automatisch entfernt.
 */
export async function sendToSubscriptions(payload, onlyEndpoint = null) {
  const keys = await getVapidKeys();
  const all = await listSubscriptions();
  const targets = Object.values(all)
    .map((e) => e.subscription)
    .filter((s) => !onlyEndpoint || s.endpoint === onlyEndpoint);

  const expired = [];
  let sent = 0;
  await Promise.all(
    targets.map(async (subscription) => {
      try {
        await webpush.sendNotification(subscription, JSON.stringify(payload), {
          vapidDetails: { subject: vapidSubject(), publicKey: keys.publicKey, privateKey: keys.privateKey },
          TTL: 60 * 60 * 12,
          urgency: "high"
        });
        sent++;
      } catch (err) {
        if (err && (err.statusCode === 404 || err.statusCode === 410)) expired.push(subscription.endpoint);
        else console.error("[push] Versand fehlgeschlagen:", err && (err.statusCode || err.message));
      }
    })
  );
  if (expired.length) await removeSubscriptions(expired);
  return { sent, total: targets.length, removed: expired.length };
}
