/* ==========================================================
   Fortschrittsfotos (Header "x-pin" erforderlich)
     POST   /api/photo          { id, image: "data:image/jpeg;base64,…" }  Bild speichern
     GET    /api/photo/:id      Bild laden (JPEG)
     DELETE /api/photo/:id      Bild löschen
   Die Bilder liegen einzeln im privaten Speicher, damit die Synchronisation
   klein und schnell bleibt. Datum, Ansicht und Notiz stehen in der Sammlung "photos".
   ========================================================== */

import { json, requirePin, readBody, photoStore } from "../shared/core.mjs";

const MAX_BYTES = 3.5 * 1024 * 1024;
const validId = (id) => typeof id === "string" && /^[\w-]{6,100}$/.test(id);

export default async (req) => {
  const denied = await requirePin(req);
  if (denied) return denied;
  const parts = new URL(req.url).pathname.replace(/\/+$/, "").split("/").filter(Boolean); // ["api","photo",":id"]
  const id = parts[2];
  try {
    if (req.method === "POST" && !id) {
      const body = (await readBody(req)) || {};
      const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(String(body.image || ""));
      if (!validId(body.id) || !m) return json(400, { error: "invalid_photo" });
      const bytes = Buffer.from(m[2], "base64");
      if (bytes.length > MAX_BYTES) return json(413, { error: "too_large" });
      await photoStore().set(body.id, bytes, { metadata: { type: `image/${m[1]}` } });
      return json(200, { ok: true, bytes: bytes.length });
    }
    if (req.method === "GET" && validId(id)) {
      const entry = await photoStore().getWithMetadata(id, { type: "arrayBuffer" });
      if (!entry || !entry.data) return json(404, { error: "not_found" });
      return new Response(entry.data, {
        status: 200,
        headers: { "content-type": (entry.metadata && entry.metadata.type) || "image/jpeg", "cache-control": "private, max-age=86400" }
      });
    }
    if (req.method === "DELETE" && validId(id)) {
      await photoStore().delete(id);
      return json(200, { ok: true });
    }
    return json(405, { error: "method_not_allowed" });
  } catch (err) {
    console.error("[photos]", err);
    return json(500, { error: "server_error" });
  }
};

export const config = { path: ["/api/photo", "/api/photo/:id"] };
