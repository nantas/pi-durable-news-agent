// The feed: news cards oldest to newest, search, timelines, card detail, feedback, and card images.
import { resolve, sep } from "node:path";
import { HFS_CATEGORIES, TAB_BYS, type CardDetail, type HfsCategory } from "@dna/sdk";
import { int, invalid, notFound, optInt } from "../errors.ts";
import { applyFeedback } from "../news/taste.ts";
import { bodyOf, oneOf, str, type Handlers, type RouteDeps } from "./types.ts";

export function labelsOf(value: unknown): HfsCategory[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value))
    throw invalid(`labels must be a list of: ${HFS_CATEGORIES.join(", ")}`);
  return [...new Set(value.map((v) => oneOf(v, "labels", HFS_CATEGORIES)!))];
}

export function feedRoutes({
  app,
}: RouteDeps): Handlers<
  | "feed"
  | "feed.search"
  | "timelines.list"
  | "timelines.get"
  | "cards.get"
  | "cards.feedback"
  | "images.get"
> {
  const { store } = app;
  return {
    feed: (req, res) => {
      const limit = Math.min(int(req.query.limit, "limit", 50), 1000);
      const items = store.news.cards({ before: optInt(req.query.before, "before"), limit });
      res.json({ items, cursor: items.length === limit ? String(items.at(-1)!.id) : undefined });
    },
    "feed.search": (req, res) => {
      const q = str(req.query as Record<string, unknown>, "q", { max: 200 });
      const by = oneOf(req.query.by, "by", TAB_BYS, true) ?? "search";
      res.json(store.news.searchCards(by, q, int(req.query.limit, "limit", 50)));
    },
    "timelines.list": (req, res) => {
      res.json(store.news.timelines(Math.min(int(req.query.limit, "limit", 20), 100)));
    },
    "timelines.get": (req, res) => {
      const id = int(req.params.id, "id");
      const summary = store.news.timelineSummary(id);
      if (!summary) throw notFound(`No timeline ${id}`);
      res.json({ ...summary, cards: store.news.timelineCards(id) });
    },
    "cards.get": (req, res) => {
      const card = store.news.card(int(req.params.id, "id"));
      if (!card) throw notFound(`No card ${req.params.id}`);
      const item = card.itemId ? store.news.item(card.itemId) : undefined;
      const detail: CardDetail = {
        card,
        item: item && {
          id: item.id,
          title: item.title,
          url: item.url,
          sourceName: item.sourceName,
          publishedAt: item.publishedAt,
          excerpt: item.excerpt,
          status: item.status,
          relevance: item.relevance,
          worth: item.worth,
          novelty: item.novelty,
          matchedTopic: item.matchedTopic,
          discussionUrl: item.discussionUrl,
        },
        findings: item ? store.news.findings(item.id) : [],
        toolCall: Number.isInteger(Number(card.toolCallId))
          ? store.telemetry.toolCallByTask(Number(card.toolCallId))
          : undefined,
      };
      res.json(detail);
    },
    "cards.feedback": (req, res) => {
      const card = store.news.card(int(req.params.id, "id"));
      if (!card) throw notFound(`No card ${req.params.id}`);
      const body = bodyOf(req);
      const signal = oneOf(body.signal, "signal", ["more", "less"] as const, true);
      const labels = labelsOf(body.labels);
      if (!signal && !labels) throw invalid("Send signal (more or less), labels, or both");
      const result = applyFeedback(store, card, { signal, labels });
      app.log.info("taste.feedback", {
        cardId: card.id,
        signal,
        labels,
        changed: result.changed.length,
        leads: result.leads.map((l) => l.site),
      });
      app.bus.publish({ type: "feed.card_updated", card: store.news.card(card.id)! });
      res.json(result);
    },
    "images.get": (req, res) => {
      const image = store.news.image(int(req.params.id, "id"));
      if (!image) throw notFound(`No image ${req.params.id}`);
      if (image.status !== "ready") throw notFound(`Image ${image.id} is ${image.status}`);
      if (image.filePath) {
        const path = resolve(image.filePath);
        if (!path.startsWith(resolve(app.config.dataDir) + sep))
          throw notFound(`Image ${image.id} has no file`);
        return res.sendFile(path, { maxAge: "7d" });
      }
      if (image.url) return res.redirect(302, image.url);
      throw notFound(`Image ${image.id} has no bytes`);
    },
  };
}
