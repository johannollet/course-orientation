// Synchronisation des tablettes : stockage de l'état de chaque séance dans Netlify Blobs.
// GET  /api/sync?room=CODE&key=state|codes  (en-tête x-if-none-match -> 304 si inchangé)
// PUT  /api/sync?room=CODE&key=state|codes  (x-if-match = écriture seulement si personne n'a modifié entre-temps,
//                                            x-if-none-match: * = création seulement)
import { getStore } from "@netlify/blobs";

const json = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });

export default async (req) => {
  const url = new URL(req.url);
  const room = (url.searchParams.get("room") || "").toUpperCase();
  const key = url.searchParams.get("key") || "state";
  if (!/^[A-Z0-9]{4,10}$/.test(room) || !["state", "codes"].includes(key)) {
    return json({ error: "requête invalide" }, 400);
  }
  const store = getStore({ name: "course-orientation-seances", consistency: "strong" });
  const blobKey = `${room}/${key}`;
  try {
    if (req.method === "GET") {
      const known = req.headers.get("x-if-none-match") || undefined;
      const entry = await store.getWithMetadata(blobKey, { type: "text", etag: known });
      if (!entry) return json({ error: "introuvable" }, 404);
      if (known && entry.etag === known) {
        return new Response(null, { status: 304, headers: { "x-etag": entry.etag, "cache-control": "no-store" } });
      }
      return new Response(entry.data, {
        status: 200,
        headers: { "content-type": "application/json", "cache-control": "no-store", "x-etag": entry.etag },
      });
    }
    if (req.method === "PUT") {
      const body = await req.text();
      if (body.length > 4_000_000) return json({ error: "données trop volumineuses" }, 413);
      try { JSON.parse(body); } catch { return json({ error: "JSON invalide" }, 400); }
      const ifMatch = req.headers.get("x-if-match");
      const ifNew = req.headers.get("x-if-none-match") === "*";
      const opts = ifMatch ? { onlyIfMatch: ifMatch } : ifNew ? { onlyIfNew: true } : {};
      const res = await store.set(blobKey, body, opts);
      if (res && res.modified === false) return json({ error: "conflit" }, 412);
      let etag = res && res.etag;
      if (!etag) {
        const meta = await store.getMetadata(blobKey);
        etag = meta && meta.etag;
      }
      return json({ etag });
    }
    return json({ error: "méthode non autorisée" }, 405);
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 500);
  }
};

export const config = { path: "/api/sync" };
