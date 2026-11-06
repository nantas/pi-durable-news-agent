import assert from "node:assert/strict";
import { test } from "node:test";
import { backfillPost, discoverX, postId } from "../src/news/x-discovery.ts";
import type { Http } from "../src/news/http.ts";

test("unauthenticated X discovery retains original and audit links while failures stay independent", async () => {
  const urls: string[] = [];
  const http: Http = {
    async get(url, options) {
      urls.push(url);
      assert.equal(options?.headers?.authorization, undefined);
      assert.equal(options?.headers?.cookie, undefined);
      return {
        url,
        status: 200,
        headers: new Headers(),
        text: url.includes("trends24")
          ? '<a class="trend-link" href="https://twitter.com/search?q=GameDesign">GameDesign</a>'
          : JSON.stringify({ code: 200, status: { text: "Public design post" } }),
      };
    },
    async postJson() {
      throw new Error("unused");
    },
  };
  const original = "https://x.com/designer/status/123456789";
  const result = await discoverX(
    {
      http,
      search: {
        async deepSearch(query) {
          assert.equal(query, "site:x.com game design");
          return {
            hits: [
              { url: original, title: "Design" },
              { url: "https://example.com/unrelated", title: "Other" },
            ],
            via: "web",
            credits: 0,
          };
        },
      },
    },
    "game design",
    original,
  );
  assert.match(result.limitations, /延迟.*缺口/);
  assert.equal(result.trends.topics.length, 1);
  assert.equal(result.indexed?.posts.length, 1);
  assert.equal(result.backfill?.url, original);
  assert.ok(urls.includes("https://api.fxtwitter.com/2/status/123456789"));
  assert.equal(postId("https://evil.example/user/status/123"), undefined);
  const failed = await backfillPost(
    {
      ...http,
      async get() {
        throw new Error("HTTP 429");
      },
    },
    original,
  );
  assert.equal(failed.ok, false);
  assert.equal(failed.url, original);
});
