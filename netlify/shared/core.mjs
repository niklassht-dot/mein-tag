/* ==========================================================
   Mein Tag – gemeinsame Server-Hilfen
   PIN-Prüfung, JSON-Antworten, Speicher (Netlify Blobs)
   ========================================================== */

import { getStore } from "@netlify/blobs";
import { createHash, timingSafeEqual } from "node:crypto";

/* PIN über Umgebungsvariable LIFE_PIN änderbar. */
const DEFAULT_PIN = "2109";

export const DATA_STORE = "mein-tag-data";
export const SYSTEM_STORE = "mein-tag-system";
export const PHOTO_STORE = "mein-tag-photos";

/** Erlaubte Sammlungen (jede liegt als eigenes Dokument im Speicher). */
export const COLLECTIONS = [
  "entries",    // DailyEntry (id = Datum)
  "sleep",      // SleepEntry (id = Datum)
  "runs",       // Run
  "runPlan",    // Laufplan (geplante Läufe)
  "plans",      // WorkoutPlan
  "sessions",   // WorkoutSession
  "events",     // Kalender: Termine, Arbeitszeiten, Training
  "todos",      // Todo
  "tags",       // Tag
  "goals",      // Goal
  "projects",   // Project
  "ideas",      // Brainstorm: Textideen
  "sketches",   // Brainstorm: Zeichnungen
  "feedback",   // Wochenfeedback (id = Wochenstart)
  "settings",   // Profil, z. B. Körpergewicht für das Rangsystem (id = "profile")
  "bodyweight", // Körpergewicht (id = Datum)
  "photos"      // Fortschrittsfotos – nur Metadaten, Bilder liegen einzeln im Speicher
];

export const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });

const sha = (v) => createHash("sha256").update(String(v)).digest();

export function pinIsValid(provided) {
  const expected = process.env.LIFE_PIN || DEFAULT_PIN;
  return Boolean(provided) && timingSafeEqual(sha(provided), sha(expected));
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Prüft den PIN-Header; gibt bei Fehler eine Antwort zurück, sonst null. */
export async function requirePin(req) {
  if (pinIsValid(req.headers.get("x-pin"))) return null;
  await sleep(600);
  return json(401, { error: "unauthorized" });
}

export async function readBody(req) {
  try { return await req.json(); } catch { return null; }
}

export function dataStore() {
  return getStore({ name: DATA_STORE, consistency: "strong" });
}

export function photoStore() {
  return getStore({ name: PHOTO_STORE, consistency: "strong" });
}

export function systemStore() {
  return getStore({ name: SYSTEM_STORE, consistency: "strong" });
}

const colKey = (name) => `col:${name}`;

/** Sammlung lesen: { version, items: { id: item } } */
export async function readCollection(name) {
  const entry = await dataStore().getWithMetadata(colKey(name), { type: "json" });
  if (!entry || !entry.data) return { doc: { version: 0, items: {} }, etag: null };
  return { doc: entry.data, etag: entry.etag };
}

/** Alle Sammlungen als { name: { version, items: [] } } */
export async function readAll(names = COLLECTIONS) {
  const out = {};
  await Promise.all(names.map(async (name) => {
    const { doc } = await readCollection(name);
    out[name] = { version: doc.version || 0, items: Object.values(doc.items || {}) };
  }));
  return out;
}

/** Atomare Änderung einer Sammlung (ETag-bedingt, mit Wiederholung). */
export async function mutateCollection(name, fn) {
  const s = dataStore();
  for (let i = 0; i < 10; i++) {
    const { doc, etag } = await readCollection(name);
    const items = { ...(doc.items || {}) };
    const result = fn(items);
    const next = { version: (doc.version || 0) + 1, updatedAt: new Date().toISOString(), items };
    const write = await s.setJSON(colKey(name), next, etag ? { onlyIfMatch: etag } : { onlyIfNew: true });
    if (write.modified !== false) return { version: next.version, result };
    await sleep(30 + Math.random() * 120);
  }
  throw new Error("busy");
}
