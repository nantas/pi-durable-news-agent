import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchSource } from "../src/news/sources/index.ts";
import { captionText } from "../src/news/sources/youtube.ts";
import type { Http } from "../src/news/http.ts";
import { tempStore } from "./helpers.ts";

test("channel listing filters restricted videos, tolerates RSS outages and backs off without disabling", async () => {
  const { store, cleanup } = tempStore();
  try {
    const source = store.sources.add({
      kind: "youtube_channel",
      name: "Fixture channel",
      url: "https://www.youtube.com/channel/UCfixture",
    });
    const http: Http = {
      async get() {
        throw Object.assign(new Error("RSS temporary outage"), { status: 500 });
      },
      async postJson() {
        throw new Error("unused");
      },
    };
    const commands: string[][] = [];
    const result = await fetchSource(source, {
      store,
      http,
      since: new Date(),
      run: async (command, args) => {
        assert.equal(command, "yt-dlp");
        commands.push(args);
        return JSON.stringify({
          entries: [
            { id: "public00001", title: "Design method", availability: "public" },
            { id: "member00001", title: "Members only", availability: "subscriber_only" },
          ],
        });
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.docs.length, 1);
    assert.ok(commands[0].includes("--flat-playlist"));
    assert.ok(!commands[0].includes("--write-subs"));
    for (let i = 0; i < 4; i++) {
      const failed = await fetchSource(source, {
        store,
        http,
        since: new Date(),
        run: async () => {
          throw new Error("temporary CLI failure");
        },
      });
      assert.equal(failed.disabled, false);
    }
    assert.equal(store.sources.get(source.id)?.enabled, true);
    assert.ok(
      !store.sources.due(new Date(Date.now() + 16 * 60000)).some((s) => s.id === source.id),
    );
  } finally {
    cleanup();
  }
});

test("VTT captions remove timing and consecutive duplicated lines", () => {
  assert.equal(
    captionText(
      "WEBVTT\nKind: captions\nLanguage: en\n\n00:00:01.000 --> 00:00:02.000\nA design method\nA design method\n\n00:00:02.000 --> 00:00:03.000\n<b>More evidence</b>",
    ),
    "A design method\nMore evidence",
  );
});
