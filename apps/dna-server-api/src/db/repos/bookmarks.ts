import type { Bookmark, Card } from "@dna/sdk";
import { type Db, nowIso } from "../db.ts";
import { canonicalUrl, urlHash } from "./sources.ts";

export class BookmarksRepo {
  constructor(private readonly db: Db) {}
  list(): Bookmark[] {
    return this.db
      .prepare(`SELECT id, item_id AS itemId, card_id AS cardId, title, url,
      source_name AS sourceName, note, created_at AS createdAt FROM bookmarks ORDER BY id DESC`)
      .all() as unknown as Bookmark[];
  }
  add(card: Card, note: string): Bookmark {
    if (!card.itemId || !card.url) throw new Error("Bookmark requires a material card");
    this.db
      .prepare(`INSERT INTO bookmarks (item_id, card_id, title, url, url_hash, source_name, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`)
      .run(
        card.itemId,
        card.id,
        card.title,
        canonicalUrl(card.url),
        urlHash(card.url),
        card.sourceName ?? null,
        note,
        nowIso(),
      );
    return this.list().find(
      (b) => b.itemId === card.itemId || urlHash(b.url) === urlHash(card.url!),
    )!;
  }
  update(id: number, note: string): Bookmark | undefined {
    this.db.prepare("UPDATE bookmarks SET note = ? WHERE id = ?").run(note, id);
    return this.list().find((b) => b.id === id);
  }
  remove(id: number): void {
    this.db.prepare("DELETE FROM bookmarks WHERE id = ?").run(id);
  }
}
