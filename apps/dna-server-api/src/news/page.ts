// The text of an item's page, for jev: the cached body when there is one, else one plain http fetch (free) through
// Readability. A feed gives a sentence or two; judging Facts needs what the page actually says.
import type { RunCommand } from "./commands.ts";
import { readYoutubeCaptions } from "./sources/youtube.ts";
import type { Logger } from "@dna/sdk/node";
import type { Item } from "../db/repos/news.ts";
import type { Store } from "../db/store.ts";
import { extractArticle } from "./extract.ts";
import type { Http } from "./http.ts";

export async function pageText(
  deps: { run?: RunCommand; http: Http; store: Store; log?: Logger },
  item: Pick<Item, "id" | "url" | "title" | "excerpt" | "cacheId">,
  max = 2400,
): Promise<string | undefined> {
  const cached = item.cacheId
    ? deps.store.sources.cachedById(item.cacheId)
    : deps.store.sources.cached(item.url);
  const video = ["www.youtube.com", "youtube.com", "youtu.be"].includes(new URL(item.url).hostname);
  if (
    (cached?.contentMd?.length ?? 0) > 500 &&
    (!video || max <= 2400 || cached?.fetchVia === "youtube-captions")
  )
    return cached!.contentMd!.slice(0, max);
  try {
    const host = new URL(item.url).hostname;
    if (max > 2400 && deps.run && ["www.youtube.com", "youtube.com", "youtu.be"].includes(host)) {
      const captions = await readYoutubeCaptions(item.url, deps.run);
      if (captions) {
        deps.store.sources.cache({
          url: item.url,
          title: item.title,
          contentMd: captions,
          fetchVia: "youtube-captions",
          ttlMinutes: 1440,
        });
        return captions.slice(0, max);
      }
    }
    const res = await deps.http.get(item.url, {
      headers: { accept: "text/html,application/xhtml+xml" },
      timeoutMs: 12_000,
    });
    const article = extractArticle(res.text, res.url || item.url, 12_000);
    if (article.text.length < 200) return undefined;
    deps.store.sources.cache({
      url: item.url,
      title: article.title ?? item.title,
      excerpt: article.excerpt ?? item.excerpt,
      contentMd: article.text,
      imageUrl: article.imageUrl,
      publishedAt: article.publishedAt,
      author: article.byline,
      fetchVia: "http",
      ttlMinutes: 24 * 60,
    });
    return article.text.slice(0, max);
  } catch (error) {
    deps.log?.warn("page.fetch_failed", { itemId: item.id, error: String(error).slice(0, 200) });
    return undefined;
  }
}
