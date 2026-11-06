import assert from "node:assert/strict";
import { test } from "node:test";
import { fauxApp } from "./helpers.ts";

test("conversation compaction uses the explicitly configured summary role", async () => {
  const { app, cleanup } = await fauxApp();
  try {
    let calls = 0;
    app.summary.ask = async (label, system, user) => {
      calls++;
      assert.equal(label, "compaction");
      assert.ok(system.includes("Preserve"));
      assert.ok(user.includes("remember"));
      return { text: "Remember the user's decisions.", costUsd: null };
    };
    for (let i = 0; i < 8; i++) {
      const input = await app.main.submit(
        { type: "input", content: `remember ${i} ${"facts ".repeat(4000)}` },
        app.ctx,
      );
      await input.wait(app.ctx);
    }
    const task = await app.main.compact(undefined, app.ctx);
    await app.harness.harness.waitForTask(task, app.ctx);
    assert.equal(calls, 1);
  } finally {
    await cleanup();
  }
});
