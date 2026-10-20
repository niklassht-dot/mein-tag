/* ==========================================================
   Erinnerungen (Netlify Scheduled Function, alle 5 Minuten)
     21:15 Uhr  Tagesabschluss – nur, wenn er noch nicht ausgefüllt ist
     30 Min.    vor Terminen und geplanten Trainings mit Uhrzeit
     8:00 Uhr   heutige offene To-dos (eine Sammel-Nachricht)
   Gesendete Erinnerungen werden protokolliert (nichts doppelt).
   ========================================================== */

import "../../public/assets/js/model.js";
import { readCollection } from "../shared/core.mjs";
import { pushStore, sendToSubscriptions, listSubscriptions } from "../shared/push-core.mjs";

const Model = globalThis.LifeModel;
const LOG_KEY = "reminder-log";
const CLOSING_TIME = 21 * 60 + 15;
const EVENT_LEAD_MIN = 30;
const TODO_TIME = 8 * 60;

const minutesOf = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ""));
  return m ? +m[1] * 60 + +m[2] : null;
};

export function dueReminders({ entries, events, todos, settings }, now) {
  const today = now.date;
  const minute = now.hour * 60 + now.minute;
  const out = [];
  // Krank oder Push-Pause → heute keine Erinnerungen
  if (Model.pushMuted(events, settings, today)) return out;

  // Tagesabschluss
  const entry = (entries || []).find((e) => e.id === today || e.date === today);
  if (minute >= CLOSING_TIME && !Model.closingDone(entry)) {
    out.push({
      key: `closing:${today}`,
      title: "Zeit für deinen Tagesabschluss",
      body: "Dankbarkeit, was lief gut und schlecht – plus deine fünf Bewertungen.",
      url: `/#/tagebuch/${today}`,
      tag: "closing"
    });
  }

  // Termine & geplante Trainings
  Model.planEventsOn(events, today).forEach((ev) => {
    if (ev.remind === false || ev.done) return;
    if (!["appointment", "training", "run"].includes(ev.type)) return;
    const start = minutesOf(ev.start);
    if (start === null) return;
    if (minute >= start - EVENT_LEAD_MIN && minute < start) {
      const where = ev.location ? ` · ${ev.location}` : "";
      out.push({
        key: `event:${ev.id}:${today}:${ev.start}`,
        title: `${{ training: "Training", run: "Lauf" }[ev.type] || "Termin"} um ${ev.start}: ${ev.title || ""}`.trim(),
        body: `In ${start - minute} Minuten${where}`,
        url: `/#/tag/${today}`,
        tag: `event-${ev.id}`
      });
    }
  });

  // Heutige To-dos
  const open = (todos || []).filter((t) => t.date === today && !t.completed);
  if (minute >= TODO_TIME && open.length) {
    out.push({
      key: `todos:${today}`,
      title: open.length === 1 ? "Heute 1 To-do" : `Heute ${open.length} To-dos`,
      body: open.slice(0, 5).map((t) => `• ${t.title}`).join("\n") + (open.length > 5 ? `\n… und ${open.length - 5} weitere` : ""),
      url: `/#/tag/${today}`,
      tag: "todos"
    });
  }
  return out;
}

export async function runReminders(date = new Date()) {
  const subs = await listSubscriptions();
  if (!Object.keys(subs).length) return { skipped: "no_devices" };
  const now = Model.nowInGermany(date);
  const [entries, events, todos, settings] = await Promise.all(["entries", "events", "todos", "settings"].map(async (n) => Object.values((await readCollection(n)).doc.items || {})));
  const reminders = dueReminders({ entries, events, todos, settings }, now);

  const store = pushStore();
  const log = (await store.get(LOG_KEY, { type: "json" })) || {};
  const sent = new Set(log.date === now.date ? log.sent || [] : []);
  let delivered = 0;
  for (const r of reminders) {
    if (sent.has(r.key)) continue;
    const res = await sendToSubscriptions({ title: r.title, body: r.body, url: r.url, tag: r.tag });
    if (res.sent) delivered++;
    sent.add(r.key);
  }
  await store.setJSON(LOG_KEY, { date: now.date, sent: [...sent] });
  return { due: reminders.length, delivered };
}

export default async () => {
  try { console.log("[reminders]", JSON.stringify(await runReminders())); }
  catch (err) { console.error("[reminders]", err); }
};

export const config = { schedule: "*/5 * * * *" };
