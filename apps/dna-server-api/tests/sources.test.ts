import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { canonicalUrl } from "../src/db/repos/sources.ts";
import { extractArticle } from "../src/news/extract.ts";
import { FIXTURES_DIR, fixtureCommand, fixtureHttp } from "../src/news/fixtures.ts";
import type { Http } from "../src/news/http.ts";
import { fetchSource } from "../src/news/sources/index.ts";
import { parseFeed } from "../src/news/sources/rss.ts";
import { listingLinks } from "../src/news/sources/webpage.ts";
import { tempStore } from "./helpers.ts";

const fixture = (name: string) =>
  readFileSync(join(FIXTURES_DIR, "news", name), "utf8")
    .replaceAll("__NOW_ISO__", new Date().toISOString())
    .replaceAll("__NOW_RFC822__", new Date().toUTCString());

test("RSS and Atom parse into entries with excerpts and images", () => {
  const rss = parseFeed(fixture("openai.rss.xml"), "https://openai.com/news/rss.xml");
  assert.equal(rss.length, 2);
  assert.equal(rss[0].title, "Codex CLI adds durable sessions that survive restarts");
  assert.match(rss[0].excerpt!, /^Codex CLI 2\.4 is available now/);
  assert.equal(rss[0].imageUrl, "https://cdn.fixture.dev/images/codex.png");
  const atom = parseFeed(fixture("simon.atom.xml"));
  assert.equal(atom[0].url, "https://simonwillison.net/2026/Oct/8/pi-durable-1-1/");
  assert.equal(atom[0].author, "Fixture Author");
  assert.throws(() => parseFeed("<html></html>"), /Not an RSS or Atom/);
});

test("listing pages yield same-host article links, and articles extract text and og:image", () => {
  const links = listingLinks(fixture("listing.html"), "https://www.anthropic.com/news");
  assert.deepEqual(
    links.map((l) => l.url),
    ["https://www.anthropic.com/news/claude-haiku-5-5-available"],
  );
  const article = extractArticle(fixture("article.html"), "https://example.com/a");
  assert.equal(article.imageUrl, "https://cdn.fixture.dev/images/article.png");
  assert.match(article.text, /migration guide/);
  assert.ok(article.publishedAt);
});

test("canonical URLs drop tracking params, fragments and www", () => {
  assert.equal(
    canonicalUrl("https://www.openai.com/news/x/?utm_source=rss&id=3#top"),
    "https://openai.com/news/x?id=3",
  );
});

test("every default source fetches through fixtures and caches its entries", async () => {
  const { store, cleanup } = tempStore();
  try {
    const http = fixtureHttp("news");
    const results = [];
    for (const source of store.sources.list())
      results.push(
        await fetchSource(source, {
          run: fixtureCommand,
          http,
          store,
          since: new Date(Date.now() - 3_600_000),
          queries: ["durable agents"],
        }),
      );
    assert.ok(
      results.every((r) => r.ok),
      JSON.stringify(results.filter((r) => !r.ok)),
    );
    const github = results.find((r) => r.source.kind === "github_releases" && r.docs.length)!;
    assert.equal(github.docs[0].title, "earendil-works/pi v1.1.0");
    const hn = results.find((r) => r.source.kind === "hn_front")!;
    assert.equal(hn.docs[0].discussionUrl, "https://news.ycombinator.com/item?id=41000001");
    assert.ok(
      store.sources.isFresh(store.sources.cached("https://openai.com/news/codex-durable-sessions")),
    );
  } finally {
    cleanup();
  }
});

test("conditional GET sends validators and a 304 caches nothing", async () => {
  const { store, cleanup } = tempStore();
  try {
    const source = store.sources.list().find((s) => s.kind === "rss")!;
    store.sources.fetched(source.id, {
      ok: true,
      status: "200",
      etag: '"abc"',
      lastModified: "Mon, 05 Oct 2026 10:00:00 GMT",
    });
    let sent: Record<string, string> = {};
    const http: Http = {
      get: async (url, options) => {
        sent = options?.headers ?? {};
        return { status: 304, url, headers: new Headers(), text: "" };
      },
      postJson: async () => {
        throw new Error("unused");
      },
    };
    const result = await fetchSource(source, { http, store, since: new Date() });
    assert.equal(sent["if-none-match"], '"abc"');
    assert.equal(sent["if-modified-since"], "Mon, 05 Oct 2026 10:00:00 GMT");
    assert.equal(result.ok, true);
    assert.equal(result.docs.length, 0);
  } finally {
    cleanup();
  }
});

test("three failures in a row disable a source", async () => {
  const { store, cleanup } = tempStore();
  try {
    const source = store.sources.list().find((s) => s.kind === "rss")!;
    const http: Http = {
      get: async () => Promise.reject(new Error("boom")),
      postJson: async () => Promise.reject(new Error("boom")),
    };
    const results = [];
    for (let i = 0; i < 3; i++)
      results.push(await fetchSource(source, { http, store, since: new Date() }));
    assert.deepEqual(
      results.map((r) => r.disabled),
      [false, false, true],
    );
    assert.equal(store.sources.get(source.id)!.enabled, false);
  } finally {
    cleanup();
  }
});

test("a sweep's feeds keep two weeks: older entries never come in, every default feed refreshes within 30 minutes", async () => {
  const { store, cleanup } = tempStore();
  try {
    const day = 86_400_000;
    const item = (title: string, ago: number) =>
      `<item><title>${title}</title><link>https://feeds.example.dev/${title}</link><pubDate>${new Date(Date.now() - ago).toUTCString()}</pubDate></item>`;
    const http: Http = {
      get: async (url) => ({
        status: 200,
        url,
        headers: new Headers(),
        text: `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>${item("fresh", 3_600_000)}${item("thirteen-days", 13 * day)}${item("fifteen-days", 15 * day)}</channel></rss>`,
      }),
      postJson: async () => {
        throw new Error("unused");
      },
    };
    const source = store.sources.list().find((s) => s.kind === "rss")!;
    const { MAX_AGE_DAYS } = await import("../src/news/sweep-task.ts");
    const result = await fetchSource(source, {
      http,
      store,
      since: new Date(Date.now() - MAX_AGE_DAYS * day),
    });
    assert.deepEqual(
      result.docs.map((d) => d.title),
      ["fresh", "thirteen-days"],
    );
    assert.ok(store.sources.list().every((s) => s.intervalMin <= 30));
    for (const term of ["leaderboard", "SWE-bench", "ARC-AGI", "reproducible"])
      assert.ok(store.taste.findKeyword("facts", term), `${term} is a Facts keyword`);
    for (const name of [
      "TechCrunch AI",
      "The Verge AI",
      "Ars Technica AI",
      "Lobsters AI",
      "Epoch AI",
      "METR",
      "SWE-bench releases",
      "Hugging Face Papers",
    ])
      assert.ok(
        store.sources.list().some((s) => s.name === name),
        `${name} is a default source`,
      );
  } finally {
    cleanup();
  }
});

test("every sweep checks a source, but an unchanged one hands nothing to jev; a 429 is a skip, not a failure", async () => {
  const { store, cleanup } = tempStore();
  try {
    let body = `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title><item><title>first</title><link>https://hash.example.dev/1</link><pubDate>${new Date().toUTCString()}</pubDate></item></channel></rss>`;
    let status = 200;
    const http: Http = {
      get: async (url) => {
        if (status === 429) throw Object.assign(new Error("HTTP 429"), { status: 429 });
        return { status: 200, url, headers: new Headers(), text: body };
      },
      postJson: async () => {
        throw new Error("unused");
      },
    };
    const source = store.sources.list().find((s) => s.kind === "rss")!;
    const since = new Date(Date.now() - 86_400_000);
    const first = await fetchSource(source, { http, store, since });
    assert.equal(first.docs.length, 1);
    const again = await fetchSource(source, { http, store, since });
    assert.equal(again.status, "unchanged");
    assert.equal(again.docs.length, 0, "an unchanged source adds nothing");
    body = body.replace(
      "</channel>",
      `<item><title>second</title><link>https://hash.example.dev/2</link><pubDate>${new Date().toUTCString()}</pubDate></item></channel>`,
    );
    const changed = await fetchSource(source, { http, store, since });
    assert.deepEqual(
      changed.docs.map((d) => d.title),
      ["first", "second"],
      "a changed source hands every entry on; items dedupe by url",
    );
    status = 429;
    for (let i = 0; i < 4; i++) {
      const limited = await fetchSource(source, { http, store, since });
      assert.equal(limited.status, "429 rate limited");
    }
    assert.equal(store.sources.list().find((s) => s.id === source.id)!.enabled, true);
  } finally {
    cleanup();
  }
});

test("configured listing paths, bounded pages and noise filters use one canonical pipeline", async () => {
  const { store, cleanup } = tempStore();
  try {
    store.sources.seed([
      {
        kind: "web_page",
        name: "Design fixture",
        url: "https://example.com/design",
        options: { paths: ["/design/"], pages: ["/design?page=1"], excludeTerms: ["discount"] },
      },
    ]);
    const source = store.sources.list().find((s) => s.name === "Design fixture")!;
    const requests: string[] = [];
    const http: Http = {
      postJson: async () => {
        throw new Error("unused");
      },
      async get(url) {
        requests.push(url);
        return {
          url,
          status: 200,
          headers: new Headers(),
          text: `<a href="/design/method?utm_source=test">A reusable design method</a><a href="/design/sale">Discount offer for tools</a><a href="/business/other">Unrelated business story</a>`,
        };
      },
    };
    const first = await fetchSource(source, { http, store, since: new Date(0) });
    assert.equal(requests.length, 2);
    assert.equal(first.docs.length, 1);
    assert.equal(first.docs[0].publishedAt, undefined);
    assert.equal(
      first.docs[0].urlHash,
      store.sources.cache({
        url: "https://example.com/design/method",
        title: "Same material",
        fetchVia: "feed",
        ttlMinutes: 60,
      }).urlHash,
    );
    const second = await fetchSource(source, { http, store, since: new Date(0) });
    assert.equal(second.status, "unchanged");
    assert.equal(second.docs.length, 0);
    assert.equal(
      listingLinks(
        '<a href="/design/old">An older design method</a>',
        source.url,
        30,
        source.options?.paths,
      ).length,
      1,
    );
  } finally {
    cleanup();
  }
});
