import { int, invalid, notFound } from "../errors.ts";
import { bodyOf, type Handlers, type RouteDeps } from "./types.ts";

export function bookmarkRoutes({
  app,
}: RouteDeps): Handlers<
  "bookmarks.list" | "bookmarks.add" | "bookmarks.update" | "bookmarks.remove"
> {
  const changed = () => app.bus.publish({ type: "bookmarks.changed" });
  return {
    "bookmarks.list": (_req, res) => res.json(app.store.bookmarks.list()),
    "bookmarks.add": (req, res) => {
      const body = bodyOf(req);
      const card = app.store.news.card(int(body.cardId, "cardId"));
      if (!card) throw notFound("No such card");
      if (!card.itemId || !card.url) throw invalid("Bookmark requires a material card");
      const note = body.note ?? "";
      if (typeof note !== "string" || note.length > 2000)
        throw invalid("note must be a string up to 2000 characters");
      const saved = app.store.bookmarks.add(card, note);
      changed();
      res.json(saved);
    },
    "bookmarks.update": (req, res) => {
      const body = bodyOf(req);
      if (typeof body.note !== "string" || body.note.length > 2000)
        throw invalid("note must be a string up to 2000 characters");
      const saved = app.store.bookmarks.update(int(req.params.id, "id"), body.note);
      if (!saved) throw notFound("No such Bookmark");
      changed();
      res.json(saved);
    },
    "bookmarks.remove": (req, res) => {
      app.store.bookmarks.remove(int(req.params.id, "id"));
      changed();
      res.json({ ok: true });
    },
  };
}
