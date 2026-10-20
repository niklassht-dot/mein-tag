/* ==========================================================
   Wochenfeedback-API (Header "x-pin" erforderlich)
     GET  /api/feedback/status        { enabled }
     POST /api/feedback/generate      { weekStart }  → Feedback erzeugen
   Ohne ANTHROPIC_API_KEY wird der fertige Auftrag (prompt) zurückgegeben,
   den man in claude.ai einfügen kann.
   ========================================================== */

import "../../public/assets/js/model.js";
import { json, requirePin, readBody } from "../shared/core.mjs";
import { generateFeedback, feedbackEnabled } from "../shared/feedback-core.mjs";

const Model = globalThis.LifeModel;

export default async (req) => {
  const denied = await requirePin(req);
  if (denied) return denied;
  const action = new URL(req.url).pathname.split("/").pop();
  try {
    if (action === "status" && req.method === "GET") return json(200, { enabled: feedbackEnabled() });
    if (action === "generate" && req.method === "POST") {
      const body = (await readBody(req)) || {};
      const ws = Model.parseISO(body.weekStart) ? Model.weekStart(body.weekStart) : Model.weekStart(Model.nowInGermany().date);
      return json(200, await generateFeedback(ws));
    }
    return json(405, { error: "method_not_allowed" });
  } catch (err) {
    console.error("[feedback]", err.message);
    return json(502, { error: "feedback_failed", message: err.message });
  }
};

export const config = { path: ["/api/feedback/status", "/api/feedback/generate"] };
