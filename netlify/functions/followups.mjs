/* ==========================================================
   Follow-ups aus der Lead-Liste (Aufwind Studio)
     GET /api/followups
   Holt die Leads serverseitig von der Lead-Liste und berechnet mit
   derselben Logik (lead-schedule.js) die offenen Anrufe/Follow-ups,
   damit sie im Kalender und in der Tagesansicht erscheinen.
   Umgebungsvariablen (optional):
     LEADS_URL  – Standard https://leadsaufwind.netlify.app
     LEADS_PIN  – Standard 2109
   ========================================================== */

import "../../public/assets/js/lead-schedule.js";
import { json, requirePin } from "../shared/core.mjs";

const Schedule = globalThis.AufwindSchedule;

export async function loadFollowUps(today = Schedule.todayInGermany()) {
  const base = (process.env.LEADS_URL || "https://leadsaufwind.netlify.app").replace(/\/+$/, "");
  const res = await fetch(`${base}/api/leads`, {
    headers: { "x-aufwind-pin": process.env.LEADS_PIN || "2109" }
  });
  if (!res.ok) throw new Error(`Lead-Liste antwortet mit ${res.status}`);
  const data = await res.json();
  const out = [];
  for (const lead of data.leads || []) {
    for (const task of Schedule.leadTasks(lead, today)) {
      if (!["overdue", "due", "upcoming"].includes(task.state)) continue;
      out.push({
        id: `${lead.id}:${task.kind}`,
        leadId: lead.id,
        company: lead.company,
        phone: lead.phone || "",
        notes: lead.notes || "",
        kind: task.kind,            // "call" | "manual"
        date: task.date,
        state: task.state,
        url: `${base}/?lead=${encodeURIComponent(lead.id)}`
      });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export default async (req) => {
  const denied = await requirePin(req);
  if (denied) return denied;
  try {
    return json(200, { items: await loadFollowUps(), source: "lead-liste" });
  } catch (err) {
    console.error("[followups]", err.message);
    return json(200, { items: [], error: "Lead-Liste nicht erreichbar" });
  }
};

export const config = { path: "/api/followups" };
