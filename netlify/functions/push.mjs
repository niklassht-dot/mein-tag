/* ==========================================================
   Push-API (Header "x-pin" erforderlich)
     GET  /api/push/key           öffentlicher Schlüssel
     POST /api/push/subscribe     { subscription, device }
     POST /api/push/unsubscribe   { endpoint }
     POST /api/push/test          { endpoint }
   ========================================================== */

import { json, requirePin, readBody } from "../shared/core.mjs";
import {
  getVapidKeys, isValidSubscription, saveSubscription, removeSubscriptions, sendToSubscriptions
} from "../shared/push-core.mjs";

export default async (req) => {
  const denied = await requirePin(req);
  if (denied) return denied;
  const action = new URL(req.url).pathname.replace(/\/+$/, "").split("/").pop();
  try {
    if (action === "key" && req.method === "GET") {
      return json(200, { publicKey: (await getVapidKeys()).publicKey });
    }
    if (action === "subscribe" && req.method === "POST") {
      const body = (await readBody(req)) || {};
      if (!isValidSubscription(body.subscription)) return json(400, { error: "invalid_subscription" });
      await saveSubscription(body.subscription, body.device);
      return json(200, { ok: true });
    }
    if (action === "unsubscribe" && req.method === "POST") {
      const body = (await readBody(req)) || {};
      if (typeof body.endpoint === "string") await removeSubscriptions([body.endpoint]);
      return json(200, { ok: true });
    }
    if (action === "test" && req.method === "POST") {
      const body = (await readBody(req)) || {};
      return json(200, await sendToSubscriptions({
        title: "Benachrichtigungen sind aktiv ✓",
        body: "Um 21:15 Uhr erinnere ich dich an deinen Tagesabschluss.",
        url: "/",
        tag: "test"
      }, typeof body.endpoint === "string" ? body.endpoint : null));
    }
    return json(405, { error: "method_not_allowed" });
  } catch (err) {
    console.error("[push]", err);
    return json(500, { error: "server_error" });
  }
};

export const config = { path: ["/api/push/key", "/api/push/subscribe", "/api/push/unsubscribe", "/api/push/test"] };
