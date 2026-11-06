// A listing page without a feed (for example anthropic.com/news): article links on the same host.
import { parseHTML } from "linkedom";
import type { FeedEntry, Fetcher } from "./types.ts";

export function listingLinks(
  html: string,
  pageUrl: string,
  limit = 30,
  paths?: string[],
): FeedEntry[] {
  const { document } = parseHTML(html);
  const page = new URL(pageUrl);
  const prefix = page.pathname.replace(/\/+$/, "");
  const seen = new Set<string>();
  const out: FeedEntry[] = [];
  for (const a of [...document.querySelectorAll("a[href]")] as any[]) {
    let url: URL;
    try {
      url = new URL(a.getAttribute("href"), page);
    } catch {
      continue;
    }
    if (
      url.host !== page.host ||
      !(paths?.length
        ? paths.some((path) => url.pathname.startsWith(path))
        : url.pathname.startsWith(`${prefix}/`)) ||
      url.pathname.replace(/\/+$/, "") === prefix
    )
      continue;
    const title = String(a.textContent ?? "")
      .replace(/\s+/g, " ")
      .trim();
    url.hash = "";
    const key = url.toString();
    if (title.length < 12 || seen.has(key)) continue;
    seen.add(key);
    out.push({ url: key, title: title.slice(0, 300) });
    if (out.length >= limit) break;
  }
  return out;
}

export const fetchWebPage: Fetcher = async (source, ctx) => {
  const urls = [
    source.url,
    ...(source.options?.pages ?? []).slice(0, 4).map((path) => {
      const url = new URL(path, source.url);
      if (url.origin !== new URL(source.url).origin)
        throw new Error("Listing pages must share the source origin");
      return url.toString();
    }),
  ];
  const entries: FeedEntry[] = [];
  const seen = new Set<string>();
  for (const url of urls) {
    const res = await ctx.http.get(url, { headers: { accept: "text/html" } });
    for (const entry of listingLinks(res.text, source.url, 30, source.options?.paths)) {
      if (!seen.has(entry.url)) {
        seen.add(entry.url);
        entries.push(entry);
      }
    }
  }
  return { ok: true, status: `200 ${entries.length} links`, entries };
};
