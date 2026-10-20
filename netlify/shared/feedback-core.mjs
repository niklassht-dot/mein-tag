/* ==========================================================
   Wochenfeedback mit Claude
   Sammelt alle Daten der Woche (Mo–So) über LifeModel.buildWeeklyContext,
   schickt sie an die Claude API und speichert das Ergebnis in der
   Sammlung "feedback" (id = Wochenstart).
   Umgebungsvariablen:
     ANTHROPIC_API_KEY  – erforderlich für automatisches Feedback
     CLAUDE_MODEL       – optional, Standard "claude-sonnet-5-5"
   ========================================================== */

import "../../public/assets/js/model.js";
import { readAll, mutateCollection } from "./core.mjs";
import { loadFollowUps } from "../functions/followups.mjs";

const Model = globalThis.LifeModel;

export const feedbackEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY);

export async function weeklyContextFor(ws) {
  const all = await readAll();
  const data = Object.fromEntries(Object.entries(all).map(([k, v]) => [k, v.items]));
  let followups = [];
  try { followups = await loadFollowUps(); } catch { followups = []; }
  return { data, context: Model.buildWeeklyContext(data, ws, followups) };
}

async function askClaude(prompt) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.CLAUDE_MODEL || "claude-sonnet-5-5",
      max_tokens: 2500,
      messages: [{ role: "user", content: prompt }]
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data.error && data.error.message) || `Claude API ${res.status}`);
  return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
}

/** Feedback für eine Woche erzeugen und speichern. */
export async function generateFeedback(ws) {
  const { context } = await weeklyContextFor(ws);
  const prompt = Model.buildFeedbackPrompt(context);
  if (!feedbackEnabled()) return { needsKey: true, prompt };
  const text = await askClaude(prompt);
  const item = {
    id: ws,
    weekStart: ws,
    weekEnd: context.week.end,
    text,
    model: process.env.CLAUDE_MODEL || "claude-sonnet-5-5",
    stats: {
      ratings: context.dailyRatings.averages,
      workouts: context.workouts.sessions.length,
      strength: context.workouts.weeklyStrengthProgressPercent,
      sleepMin: context.sleep.averageDurationMin,
      km: context.runs.totalKm,
      todosDone: context.todos.completed,
      todosTotal: context.todos.total
    }
  };
  const out = await mutateCollection("feedback", (items) => {
    const now = new Date().toISOString();
    items[ws] = { ...item, createdAt: now, updatedAt: now };
    return items[ws];
  });
  return { item: out.result, version: out.version };
}
