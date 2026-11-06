import assert from "node:assert/strict";
import { test } from "node:test";
import { searchReferences } from "../src/news/references.ts";
import type { Http } from "../src/news/http.ts";

test("reference APIs return only metadata and original links, with independent access failures", async () => {
  const urls: string[] = [];
  const http: Http = {
    async get(url) {
      urls.push(url);
      return {
        url,
        status: 200,
        headers: new Headers(),
        text: JSON.stringify(
          url.includes("artic.edu")
            ? {
                data: [
                  {
                    id: 123,
                    title: "Landscape",
                    artist_title: "Artist",
                    is_public_domain: true,
                    image_url: "https://image.invalid/no-download",
                  },
                ],
              }
            : [
                {
                  id: 456,
                  tags: "animated effects",
                  file_url: "https://video.invalid/no-download",
                },
              ],
        ),
      };
    },
    async postJson() {
      throw new Error("unused");
    },
  };
  const art = await searchReferences(http, "landscape & mountains", "artic");
  assert.equal(art.results[0].url, "https://www.artic.edu/artworks/123");
  assert.match(art.results[0].rights, /公有领域/);
  const animation = await searchReferences(http, "effects rating:e", "sakugabooru");
  assert.equal(animation.results[0].url, "https://www.sakugabooru.com/post/show/456");
  assert.equal(new URL(urls[1]).searchParams.get("tags"), "effects rating:s");
  assert.equal(urls.length, 2);
  assert.ok(!JSON.stringify([art, animation]).includes("no-download"));
  const failed = await searchReferences(
    {
      ...http,
      async get() {
        throw new Error("HTTP 403");
      },
    },
    "art",
    "artic",
  );
  assert.equal(failed.ok, false);
  assert.match(failed.error!, /403/);
});
