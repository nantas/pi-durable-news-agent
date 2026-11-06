import { parseHTML } from "linkedom";
import type { Http } from "./http.ts";
import type { SearchService } from "./search/index.ts";

export const X_LIMITATIONS =
  "辅助线索存在搜索索引延迟与覆盖缺口；不提供实时、完整或稳定的 X 关键词监控，不是核心定时来源。公开回填来自第三方 FxEmbed，可能失败。";
const HOSTS = ["x.com", "www.x.com", "twitter.com", "www.twitter.com"];
export function postId(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !HOSTS.includes(parsed.hostname)) return undefined;
    return parsed.pathname.match(
      /^\/(?:[\w]+|i\/web)\/status\/(\d{2,20})(?:\/(?:photo|video)\/\d+)?\/?$/,
    )?.[1];
  } catch {
    return undefined;
  }
}
export function trendTopics(html: string): { topic: string; url: string; source: string }[] {
  const { document } = parseHTML(html);
  const seen = new Set<string>();
  const topics = [];
  for (const link of document.querySelectorAll("a.trend-link[href]")) {
    const topic = link.textContent?.trim();
    const href = link.getAttribute("href");
    if (!topic || !href || seen.has(topic)) continue;
    try {
      const url = new URL(href);
      if (!HOSTS.includes(url.hostname) || url.pathname !== "/search") continue;
      seen.add(topic);
      topics.push({ topic, url: url.toString(), source: "https://trends24.in/" });
    } catch {
      continue;
    }
    if (topics.length === 10) break;
  }
  return topics;
}
export async function backfillPost(http: Http, url: string) {
  const id = postId(url);
  if (!id) throw new Error("Provide a public https X/Twitter status URL");
  const source = `https://api.fxtwitter.com/2/status/${id}`;
  try {
    const payload = JSON.parse((await http.get(source)).text) as {
      code: number;
      status?: { text?: string; created_at?: string };
    };
    if (payload.code !== 200 || typeof payload.status?.text !== "string")
      throw new Error(`Public post unavailable (${payload.code})`);
    return {
      ok: true,
      url,
      source,
      text: payload.status.text,
      createdAt: payload.status.created_at,
    };
  } catch (error) {
    return { ok: false, url, source, error: String(error) };
  }
}
export async function discoverX(
  deps: { http: Http; search: Pick<SearchService, "deepSearch"> },
  query?: string,
  url?: string,
) {
  const [trends, indexed, backfill] = await Promise.all([
    (async () => {
      try {
        return {
          ok: true,
          source: "https://trends24.in/",
          topics: trendTopics((await deps.http.get("https://trends24.in/")).text),
        };
      } catch (error) {
        return { ok: false, source: "https://trends24.in/", topics: [], error: String(error) };
      }
    })(),
    (async () => {
      if (!query) return undefined;
      try {
        const result = await deps.search.deepSearch(`site:x.com ${query}`, {}, { limit: 8 });
        return {
          ok: true,
          via: result.engines ?? result.via,
          posts: result.hits
            .filter((hit) => postId(hit.url))
            .map((hit) => ({
              url: hit.url,
              title: hit.title,
              excerpt: hit.excerpt,
              publishedAt: hit.publishedAt,
            })),
        };
      } catch (error) {
        return { ok: false, posts: [], error: String(error) };
      }
    })(),
    url ? backfillPost(deps.http, url) : undefined,
  ]);
  return { limitations: X_LIMITATIONS, trends, indexed, backfill };
}
