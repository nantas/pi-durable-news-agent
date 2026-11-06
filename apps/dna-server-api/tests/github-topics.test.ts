import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchSource } from "../src/news/sources/index.ts";
import { starDeltas } from "../src/news/sources/github-topic.ts";
import { fixtureHttp } from "../src/news/fixtures.ts";
import { tempStore } from "./helpers.ts";

test("GitHub classifies purpose before popularity, records official net growth and caches requests", async () => {
  const { store, cleanup } = tempStore();
  try {
    const source = store.sources.add({
      kind: "github_topic",
      name: "Game topics",
      query: "topic:godot",
    });
    const now = new Date();
    const day = (n: number) => new Date(now.getTime() - n * 86400000).toISOString().slice(0, 10);
    store.sources.cache({
      url: "https://github.com/example/engine",
      fetchVia: "feed",
      ttlMinutes: -1,
      metadata: {
        github: {
          history: [
            { day: day(7), stars: 80 },
            { day: day(30), stars: 60 },
          ],
        },
      },
    });
    const requests: string[][] = [];
    const run = async (command: string, args: string[]) => {
      assert.equal(command, "gh");
      requests.push(args);
      if (args.includes("search/repositories"))
        return JSON.stringify({
          items: [
            {
              full_name: "example/engine",
              html_url: "https://github.com/example/engine",
              description: "A Godot game engine",
              topics: ["godot"],
              stargazers_count: 100,
              pushed_at: "2026-11-01",
              created_at: "2026-01-01",
            },
            {
              full_name: "example/stocks",
              html_url: "https://github.com/example/stocks",
              description: "Trading stocks",
              topics: ["finance"],
              stargazers_count: 1000000,
            },
          ],
        });
      if (args.includes("repos/example/engine/readme")) return "Godot game engine tools";
      if (args.includes("repos/example/engine/releases/latest"))
        return JSON.stringify({ tag_name: "v1", published_at: "2026-11-01" });
      throw new Error("Unexpected request");
    };
    const deps = { store, http: fixtureHttp(), run, since: new Date(0) };
    const result = await fetchSource(source, deps);
    assert.equal(result.docs.length, 1);
    const metrics = result.docs[0].metadata?.github as {
      stars7d: number;
      stars30d: number;
      category: string;
    };
    assert.equal(metrics.stars7d, 20);
    assert.equal(metrics.stars30d, 40);
    assert.equal(metrics.category, "engine");
    assert.equal(requests.length, 3);
    await fetchSource(source, deps);
    assert.equal(requests.length, 4);
    assert.deepEqual(starDeltas([{ day: day(0), stars: 10 }], now), {
      stars7d: undefined,
      stars30d: undefined,
    });
  } finally {
    cleanup();
  }
});
