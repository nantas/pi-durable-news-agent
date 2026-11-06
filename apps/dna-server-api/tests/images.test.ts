import assert from "node:assert/strict";
import { test } from "node:test";
import { Images } from "../src/news/images.ts";
import { fixtureHttp } from "../src/news/fixtures.ts";
import { tempStore } from "./helpers.ts";

test("only valid source images are saved; missing and failed images never create generated rows", async () => {
  const { store, cleanup } = tempStore();
  try {
    const images = new Images({ store, http: fixtureHttp("news") });
    const item = (suffix: string, imageUrl?: string) =>
      store.news.upsertItem({ url: `https://example.com/${suffix}`, title: suffix, imageUrl }).item;
    const ready = await images.resolve(item("source", "https://cdn.fixture.dev/images/codex.png"));
    assert.equal(store.news.image(ready!)?.origin, "source");
    assert.equal(await images.resolve(item("missing")), undefined);
    const failed = new Images({
      store,
      http: {
        ...fixtureHttp(),
        async get() {
          throw new Error("HTTP 404");
        },
      },
    });
    assert.equal(await failed.resolve(item("failed", "https://example.com/broken.png")), undefined);
    assert.equal(
      store.db.prepare("SELECT count(*) n FROM images WHERE origin='generated'").get()?.n,
      0,
    );
  } finally {
    cleanup();
  }
});
