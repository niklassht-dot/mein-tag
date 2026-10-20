/* ==========================================================
   Strava-API
     GET  /api/strava/status       Verbindungsstatus
     POST /api/strava/connect      → { url } zur Strava-Anmeldung
     GET  /api/strava/callback     Rücksprung von Strava (ohne PIN, mit state)
     POST /api/strava/disconnect   Verbindung trennen
     POST /api/strava/activity     { url } → Werte des Laufs
     POST /api/strava/import       neue Läufe der letzten 30 Tage übernehmen
   ========================================================== */

import { randomUUID } from "node:crypto";
import { json, requirePin, readBody, readCollection, mutateCollection } from "../shared/core.mjs";
import {
  stravaConfigured, startAuth, finishAuth, disconnect, activityFromLink, recentRuns, connectionStatus, siteUrl
} from "../shared/strava.mjs";

const pace = (km, sec) => {
  if (!km || !sec) return "";
  const p = sec / km;
  return `${Math.floor(p / 60)}:${String(Math.round(p % 60) % 60).padStart(2, "0")}`;
};

export default async (req) => {
  const action = new URL(req.url).pathname.replace(/\/+$/, "").split("/").pop();

  /* Rücksprung von Strava – geschützt über den einmaligen state-Wert */
  if (action === "callback") {
    const u = new URL(req.url);
    const base = `${u.protocol}//${u.host}`; // zurück zu genau der Adresse, an die Strava geschickt hat
    try {
      if (u.searchParams.get("error")) throw new Error("abgebrochen");
      await finishAuth(u.searchParams.get("code"), u.searchParams.get("state"));
      return Response.redirect(`${base}/#/laufen?strava=ok`, 302);
    } catch (err) {
      console.error("[strava callback]", err.message);
      return Response.redirect(`${base}/#/laufen?strava=fehler`, 302);
    }
  }

  const denied = await requirePin(req);
  if (denied) return denied;

  try {
    if (action === "status" && req.method === "GET") return json(200, await connectionStatus(req));

    if (action === "connect" && req.method === "POST") {
      if (!stravaConfigured()) return json(400, { error: "not_configured", message: "STRAVA_CLIENT_ID und STRAVA_CLIENT_SECRET fehlen in Netlify." });
      const body = (await readBody(req)) || {};
      return json(200, { url: await startAuth(req, body.origin) });
    }

    if (action === "disconnect" && req.method === "POST") { await disconnect(); return json(200, { ok: true }); }

    if (action === "activity" && req.method === "POST") {
      const body = (await readBody(req)) || {};
      const { run, source } = await activityFromLink(body.url);
      return json(200, { run: { ...run, pace: pace(run.distance, run.duration) }, source });
    }

    if (action === "import" && req.method === "POST") {
      const runs = await recentRuns(30);
      const { doc } = await readCollection("runs");
      const known = new Set(Object.values(doc.items || {}).map((r) => String(r.stravaId || "")).filter(Boolean));
      const fresh = runs.filter((r) => !known.has(String(r.stravaId)));
      if (fresh.length) {
        const now = new Date().toISOString();
        await mutateCollection("runs", (items) => {
          fresh.forEach((r) => {
            const id = randomUUID();
            items[id] = { id, ...r, pace: pace(r.distance, r.duration), source: "strava", createdAt: now, updatedAt: now };
          });
        });
      }
      return json(200, { imported: fresh.length, checked: runs.length });
    }

    return json(405, { error: "method_not_allowed" });
  } catch (err) {
    console.error("[strava]", err.message);
    return json(422, { error: "strava_failed", message: err.message });
  }
};

export const config = {
  path: ["/api/strava/status", "/api/strava/connect", "/api/strava/callback", "/api/strava/disconnect", "/api/strava/activity", "/api/strava/import"]
};
