// Card images come only from the source; missing or unusable images stay absent.
import type { Item } from "../db/repos/news.ts";
import type { Store } from "../db/store.ts";
import type { Http } from "./http.ts";

export interface ImageDeps {
  store: Store;
  http: Http;
  offline?: boolean;
}

export class Images {
  constructor(private readonly deps: ImageDeps) {}

  /** A usable source image, checked with a small GET: image content type, under 5 MB. */
  async sourceImage(url: string | undefined): Promise<string | undefined> {
    if (!url || !/^https?:\/\//.test(url)) return undefined;
    if (this.deps.offline) return url;
    try {
      const res = await this.deps.http.get(url, {
        headers: { accept: "image/*" },
        timeoutMs: 8000,
        maxBytes: 5 * 1024 * 1024,
      });
      const type = res.headers.get("content-type") ?? "";
      return type.startsWith("image/") ? res.url : undefined;
    } catch {
      return undefined;
    }
  }

  /** Resolve an item's image now if the source has one. Returns undefined when no usable source image exists. */
  async resolve(item: Item): Promise<number | undefined> {
    const cached = item.cacheId ? this.deps.store.sources.cachedById(item.cacheId) : undefined;
    const url = await this.sourceImage(item.imageUrl ?? cached?.imageUrl);
    if (!url) return undefined;
    return this.deps.store.news.addImage({
      origin: "source",
      status: "ready",
      url,
      itemId: item.id,
    });
  }
}
