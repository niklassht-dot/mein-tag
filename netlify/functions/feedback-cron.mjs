/* ==========================================================
   Automatisches Wochenfeedback – sonntags ab 19:00 Uhr (deutsche Zeit).
   Läuft stündlich am Sonntag, erzeugt das Feedback einmal pro Woche
   und meldet es per Push.
   ========================================================== */

import "../../public/assets/js/model.js";
import { readCollection } from "../shared/core.mjs";
import { generateFeedback, feedbackEnabled } from "../shared/feedback-core.mjs";
import { sendToSubscriptions } from "../shared/push-core.mjs";

const Model = globalThis.LifeModel;

export default async () => {
  try {
    const now = Model.nowInGermany();
    const weekday = new Date(`${now.date}T12:00:00Z`).getUTCDay();
    if (weekday !== 0 || now.hour < 19 || !feedbackEnabled()) return;
    const ws = Model.weekStart(now.date);
    const { doc } = await readCollection("feedback");
    if (doc.items && doc.items[ws]) return;
    await generateFeedback(ws);
    const [events, settings] = await Promise.all(["events", "settings"].map(async (n) => Object.values((await readCollection(n)).doc.items || {})));
    if (Model.pushMuted(events, settings, now.date)) return;
    await sendToSubscriptions({
      title: "Dein Wochenfeedback ist da",
      body: "Claude hat deine Woche ausgewertet – Muster, Aufschieben, nächste Schritte.",
      url: "/#/woche",
      tag: `feedback-${ws}`
    });
  } catch (err) {
    console.error("[feedback-cron]", err.message);
  }
};

export const config = { schedule: "0 * * * 0" };
