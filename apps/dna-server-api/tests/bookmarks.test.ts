import assert from "node:assert/strict";
import { test } from "node:test";
import { until } from "./helpers.ts";
import { bootServer, settledSweep, idle } from "./server.ts";

test("Bookmark requests dedupe, persist after restart, edit notes and remove without workflow work", async () => {
  const server = await bootServer();
  try {
    const sweep = await server.cron.newsSweep({ requestId: "bookmark-fixture" });
    await settledSweep(server.client, sweep.data.sweep!.id);
    await idle(server.client);
    const card = (await server.client.feed()).items[0];
    const stop = new AbortController();
    let connected = false;
    let changes = 0;
    const reading = (async () => {
      for await (const frame of server.client.stream(stop.signal)) {
        if (frame.type === "hello") connected = true;
        if (frame.type === "bookmarks.changed") changes++;
      }
    })();
    try {
      await until(() => connected);
      await server.client.addBookmark(card.id);
      await until(() => changes === 1);
    } finally {
      stop.abort();
      await reading;
    }
    const saved = await server.client.addBookmark(card.id);
    const duplicate = await server.client.addBookmark(card.id, "Ignored retry note");
    assert.deepEqual(duplicate, saved);
    assert.equal((await server.client.bookmarks()).length, 1);
    await server.client.updateBookmark(saved.id, "Updated note");
    await server.stop();
    await server.start();
    assert.equal((await server.client.bookmarks())[0].note, "Updated note");
    await server.client.updateBookmark(saved.id, "");
    assert.equal((await server.client.bookmarks())[0].note, "");
    await server.client.removeBookmark(saved.id);
    await server.client.removeBookmark(saved.id);
    assert.deepEqual(await server.client.bookmarks(), []);
    await assert.rejects(server.client.addBookmark(999999), /No such card/);
    assert.equal((await server.client.agent()).busy, false);
  } finally {
    await server.cleanup();
  }
});
