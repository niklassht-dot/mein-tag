/* ==========================================================
   Strava-Anbindung
   - Offizielle Strava-API (OAuth): liest Datum, Distanz, Zeit, Pace
     deiner Aktivität aus dem Link und kann neue Läufe importieren.
     Benötigt STRAVA_CLIENT_ID und STRAVA_CLIENT_SECRET (Netlify-Umgebungsvariablen).
   - Ohne Verbindung: Versuch, die öffentliche Aktivitätsseite auszulesen
     (funktioniert nur bei öffentlich sichtbaren Aktivitäten).
   Tokens liegen privat in Netlify Blobs.
   ========================================================== */

import { randomBytes } from "node:crypto";
import { systemStore } from "./core.mjs";

const TOKEN_KEY = "strava-token";
const STATE_KEY = "strava-state";

export const stravaConfigured = () => Boolean(process.env.STRAVA_CLIENT_ID && process.env.STRAVA_CLIENT_SECRET);

export function siteUrl(req) {
  if (process.env.URL) return process.env.URL.replace(/\/+$/, "");
  const u = new URL(req.url);
  return `${u.protocol}//${u.host}`;
}

/* ---------------- OAuth ---------------- */

/**
 * Basis-Adresse für den Rücksprung. Strava akzeptiert nur Adressen, deren Domain
 * exakt der „Authorization Callback Domain“ der Strava-App entspricht.
 * Wir nehmen die Adresse, unter der die App gerade geöffnet ist (vom Browser gemeldet),
 * damit es auch mit eigener Domain oder geänderter Netlify-Adresse passt.
 */
export function callbackBase(req, origin) {
  try {
    const u = new URL(origin || "");
    const reqHost = new URL(req.url).host;
    const siteHost = process.env.URL ? new URL(process.env.URL).host : "";
    if ((u.protocol === "https:" || u.hostname === "localhost") && (u.host === reqHost || u.host === siteHost)) return `${u.protocol}//${u.host}`;
  } catch (e) { /* ungültig → Standard */ }
  return siteUrl(req);
}

export async function startAuth(req, origin) {
  const state = randomBytes(16).toString("hex");
  const base = callbackBase(req, origin);
  await systemStore().setJSON(STATE_KEY, { state, at: Date.now(), base });
  const redirect = `${base}/api/strava/callback`;
  const params = new URLSearchParams({
    client_id: process.env.STRAVA_CLIENT_ID,
    redirect_uri: redirect,
    response_type: "code",
    approval_prompt: "auto",
    scope: "read,activity:read_all",
    state
  });
  return `https://www.strava.com/oauth/authorize?${params}`;
}

async function tokenRequest(body) {
  const res = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: process.env.STRAVA_CLIENT_ID, client_secret: process.env.STRAVA_CLIENT_SECRET, ...body })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Strava ${res.status}`);
  return data;
}

export async function finishAuth(code, state) {
  const saved = await systemStore().get(STATE_KEY, { type: "json" });
  if (!saved || saved.state !== state || Date.now() - saved.at > 15 * 60 * 1000) throw new Error("Ungültige oder abgelaufene Anmeldung");
  const data = await tokenRequest({ code, grant_type: "authorization_code" });
  await systemStore().setJSON(TOKEN_KEY, {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at,
    athlete: data.athlete ? { id: data.athlete.id, name: [data.athlete.firstname, data.athlete.lastname].filter(Boolean).join(" ") } : null
  });
  await systemStore().delete(STATE_KEY);
}

export async function disconnect() {
  await systemStore().delete(TOKEN_KEY);
}

export async function getToken() {
  const t = await systemStore().get(TOKEN_KEY, { type: "json" });
  if (!t) return null;
  if (t.expires_at * 1000 > Date.now() + 60_000) return t;
  const data = await tokenRequest({ refresh_token: t.refresh_token, grant_type: "refresh_token" });
  const next = { ...t, access_token: data.access_token, refresh_token: data.refresh_token, expires_at: data.expires_at };
  await systemStore().setJSON(TOKEN_KEY, next);
  return next;
}

/* ---------------- Aktivität aus Link ---------------- */

/** Aktivitäts-ID aus Link (auch strava.app.link-Kurzlinks). */
export async function resolveActivityId(input) {
  const text = String(input || "").trim();
  const direct = /strava\.com\/activities\/(\d+)/i.exec(text);
  if (direct) return direct[1];
  if (/^\d{6,}$/.test(text)) return text;
  if (/^https:\/\/([\w-]+\.)*(strava\.app\.link|strava\.com)\//i.test(text)) {
    const res = await fetch(text, { redirect: "follow", headers: { "user-agent": "Mozilla/5.0" } });
    const m = /strava\.com\/activities\/(\d+)/i.exec(res.url) || /strava\.com\/activities\/(\d+)/i.exec(await res.text());
    if (m) return m[1];
  }
  return null;
}

/** Strava-Aktivität (API) → unser Lauf-Format */
function toRun(a, id) {
  const distance = Math.round(((a.distance || 0) / 1000) * 100) / 100;
  return {
    stravaId: String(a.id || id),
    name: a.name || "",
    type: a.sport_type || a.type || "",
    date: String(a.start_date_local || "").slice(0, 10),
    distance,
    duration: a.moving_time || a.elapsed_time || 0,
    elapsed: a.elapsed_time || 0,
    elevation: Math.round(a.total_elevation_gain || 0),
    avgHeartrate: a.average_heartrate ? Math.round(a.average_heartrate) : null,
    stravaUrl: `https://www.strava.com/activities/${a.id || id}`
  };
}

async function fromApi(id) {
  const token = await getToken();
  if (!token) return null;
  const res = await fetch(`https://www.strava.com/api/v3/activities/${id}`, { headers: { authorization: `Bearer ${token.access_token}` } });
  if (res.status === 404 || res.status === 403) throw new Error("Aktivität nicht gefunden oder nicht freigegeben");
  if (!res.ok) throw new Error(`Strava ${res.status}`);
  return toRun(await res.json(), id);
}

/** Fallback: öffentliche Aktivitätsseite auslesen (Meta-Angaben). */
async function fromPublicPage(id) {
  const res = await fetch(`https://www.strava.com/activities/${id}`, {
    headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15", "accept-language": "de-DE,de;q=0.9,en;q=0.8" }
  });
  if (!res.ok) return null;
  const html = await res.text();
  const meta = (name) => {
    const m = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']*)["']`, "i").exec(html)
      || new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${name}["']`, "i").exec(html);
    return m ? m[1].replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"') : "";
  };
  const text = [meta("og:description"), meta("description"), meta("og:title"), meta("twitter:description")].join(" · ");

  // Distanz: "7,40 km" / "7.4 km"
  const dist = /(\d+(?:[.,]\d+)?)\s*km/i.exec(text);
  // Zeit: "38:10" oder "1:02:33" oder "38m 10s" / "1h 2m"
  let duration = 0;
  const hms = /(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(text.replace(/\d+[.,]\d+\s*km/i, ""));
  const hm = /(?:(\d+)\s*h)?\s*(\d+)\s*m(?:in)?\s*(?:(\d+)\s*s)?/i.exec(text);
  if (hms) duration = hms[3] ? (+hms[1]) * 3600 + (+hms[2]) * 60 + (+hms[3]) : (+hms[1]) * 60 + (+hms[2]);
  else if (hm && (hm[1] || hm[2])) duration = (+(hm[1] || 0)) * 3600 + (+(hm[2] || 0)) * 60 + (+(hm[3] || 0));

  // Datum aus JSON in der Seite (startDateLocal / start_date_local)
  const dateM = /"start(?:_date_local|DateLocal|Date)"\s*:\s*"(\d{4}-\d{2}-\d{2})/i.exec(html);
  if (!dist) return null;
  return {
    stravaId: String(id),
    name: meta("og:title").split("|")[0].trim(),
    date: dateM ? dateM[1] : "",
    distance: Number(dist[1].replace(",", ".")),
    duration,
    stravaUrl: `https://www.strava.com/activities/${id}`,
    partial: !duration || !dateM
  };
}

export async function activityFromLink(link) {
  const id = await resolveActivityId(link);
  if (!id) throw new Error("Kein gültiger Strava-Aktivitätslink");
  let apiError = null;
  try {
    const run = await fromApi(id);
    if (run) return { run, source: "api" };
  } catch (e) { apiError = e; }
  const run = await fromPublicPage(id).catch(() => null);
  if (run) return { run, source: "public" };
  if (apiError) throw apiError;
  throw new Error(stravaConfigured()
    ? "Strava ist nicht verbunden – unter Laufen „Strava verbinden“ tippen."
    : "Werte nicht lesbar: Aktivität ist nicht öffentlich und die Strava-Verbindung ist noch nicht eingerichtet.");
}

/** Läufe der letzten Tage (für den Import). */
export async function recentRuns(days = 30) {
  const token = await getToken();
  if (!token) throw new Error("Strava ist nicht verbunden");
  const after = Math.floor(Date.now() / 1000) - days * 86400;
  const res = await fetch(`https://www.strava.com/api/v3/athlete/activities?after=${after}&per_page=100`, { headers: { authorization: `Bearer ${token.access_token}` } });
  if (!res.ok) throw new Error(`Strava ${res.status}`);
  const list = await res.json();
  return list.filter((a) => /run/i.test(a.sport_type || a.type || "")).map((a) => toRun(a, a.id));
}

export async function connectionStatus(req) {
  const t = await systemStore().get(TOKEN_KEY, { type: "json" });
  return {
    configured: stravaConfigured(),
    connected: Boolean(t),
    athlete: t && t.athlete ? t.athlete.name : "",
    callbackDomain: new URL(req.url).host
  };
}
