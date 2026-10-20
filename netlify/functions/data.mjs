/* ==========================================================
   Daten-API (Header "x-pin" erforderlich)
     GET  /api/sync?v={"todos":3,...}   geänderte Sammlungen laden
     POST /api/data/:collection         { op: "upsert", item } | { op: "delete", id }
   Jede Änderung betrifft genau ein Element und wird atomar gespeichert,
   damit Handy und Rechner gleichzeitig arbeiten können.
   ========================================================== */

import { randomUUID } from "node:crypto";
import {
  json, requirePin, readBody, COLLECTIONS, readAll, mutateCollection, systemStore
} from "../shared/core.mjs";

const MAX_ITEM_BYTES = 4 * 1024 * 1024; // Zeichnungen können groß sein

/* Startbestand: die drei laufenden Projekte aus der Beschreibung. */
const SEED_PROJECTS = ["Fusion Verein", "Caravan", "BauDienstLei"];

/* Start-Wochenroutine (wiederkehrend, frei änderbar):
   Arbeit Mo–Fr 08:15–16:15 · Lauf Mi + Sa · Gym Mo/Di/Do/Fr */
async function seedRoutineOnce() {
  const s = systemStore();
  if (await s.get("seeded-routine-v1", { type: "json" })) return;
  const write = await s.setJSON("seeded-routine-v1", { at: new Date().toISOString() }, { onlyIfNew: true });
  if (write.modified === false) return;
  const now = new Date().toISOString();
  const todayDE = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date());
  const d = new Date(`${todayDE}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // Montag dieser Woche
  const today = d.toISOString().slice(0, 10);
  const routine = [
    { type: "work", title: "Arbeit", start: "08:15", end: "16:15", weekdays: [1, 2, 3, 4, 5] },
    { type: "run", title: "Lauf", start: "", end: "", weekdays: [3, 6] },
    { type: "training", title: "Gym", start: "", end: "", weekdays: [1, 2, 4, 5] }
  ];
  await mutateCollection("events", (items) => {
    if (Object.values(items).some((e) => e.repeat && e.repeat !== "none")) return;
    routine.forEach((r) => {
      const id = randomUUID();
      items[id] = { id, ...r, date: today, repeat: "weekly", until: "", skipDates: [], doneDates: [], location: "", department: "", remind: r.type === "training", notes: "", createdAt: now, updatedAt: now };
    });
  });
}

async function seedOnce() {
  await seedRoutineOnce();
  const s = systemStore();
  if (await s.get("seeded", { type: "json" })) return;
  const write = await s.setJSON("seeded", { at: new Date().toISOString() }, { onlyIfNew: true });
  if (write.modified === false) return;
  const now = new Date().toISOString();
  await mutateCollection("projects", (items) => {
    SEED_PROJECTS.forEach((title) => {
      const id = randomUUID();
      items[id] = { id, title, status: "Aktiv", progress: 0, notes: "", createdAt: now, updatedAt: now };
    });
  });
}

export default async (req) => {
  const denied = await requirePin(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const parts = url.pathname.replace(/\/+$/, "").split("/").filter(Boolean); // ["api","sync"] | ["api","data",":col"]
  const method = req.method.toUpperCase();

  try {
    /* ---- Synchronisieren ---- */
    if (parts[1] === "sync" && method === "GET") {
      await seedOnce();
      let known = {};
      try { known = JSON.parse(url.searchParams.get("v") || "{}") || {}; } catch { known = {}; }
      const all = await readAll();
      const cols = {};
      for (const [name, col] of Object.entries(all)) {
        if (known[name] !== col.version) cols[name] = col;
      }
      return json(200, { cols, serverTime: new Date().toISOString() });
    }

    /* ---- Ein Element ändern ---- */
    if (parts[1] === "data" && method === "POST") {
      const name = parts[2];
      if (!COLLECTIONS.includes(name)) return json(404, { error: "unknown_collection" });
      const body = await readBody(req);
      if (!body || typeof body !== "object") return json(400, { error: "invalid_body" });

      if (body.op === "upsert") {
        const item = body.item;
        if (!item || typeof item !== "object" || Array.isArray(item)) return json(400, { error: "invalid_item" });
        if (typeof item.id !== "string" || !item.id || item.id.length > 100) return json(400, { error: "invalid_id" });
        if (JSON.stringify(item).length > MAX_ITEM_BYTES) return json(413, { error: "too_large" });
        const now = new Date().toISOString();
        const out = await mutateCollection(name, (items) => {
          const saved = { ...item, createdAt: (items[item.id] && items[item.id].createdAt) || item.createdAt || now, updatedAt: now };
          items[item.id] = saved;
          return saved;
        });
        return json(200, { version: out.version, item: out.result });
      }

      if (body.op === "delete") {
        if (typeof body.id !== "string") return json(400, { error: "invalid_id" });
        const out = await mutateCollection(name, (items) => { delete items[body.id]; });
        return json(200, { version: out.version, ok: true });
      }

      return json(400, { error: "unknown_op" });
    }

    return json(405, { error: "method_not_allowed" });
  } catch (err) {
    console.error("[data]", err);
    return json(500, { error: "server_error" });
  }
};

export const config = { path: ["/api/sync", "/api/data/:collection"] };
