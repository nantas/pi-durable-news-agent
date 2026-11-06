import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { configure } from "@earendil-works/pi-durable";
import { say } from "../src/index.ts";
import { fauxHarness, tempDir } from "./helpers.ts";

test("a 1.1 database resumes its pending request on 1.5 and does not replay after reopening", async () => {
  const t = tempDir();
  try {
    const db = new DatabaseSync(join(t.dir, "agent.sqlite"));
    db.exec(readFileSync(join(import.meta.dirname, "fixtures/legacy-1.1.sql"), "utf8"));
    db.close();
    let calls = 0;
    const rules = [
      () => {
        calls++;
        return say("Recovered legacy request");
      },
    ];
    let app = await fauxHarness(t.dir, rules, []);
    await app.harness.commit(
      (tx) => configure(tx, app.root.id, { model: app.catalog.defaultModel }),
      app.ctx,
    );
    app.harness.resume();
    await app.root.waitForIdle(app.ctx);
    const page = await app.root.entries({ order: "ascending" }, 100, undefined, app.ctx);
    assert.equal(calls, 1);
    assert.equal(page.items.filter((e) => e.kind === "pi.user").length, 1);
    assert.equal(page.items.filter((e) => e.kind === "pi.assistant").length, 1);
    await app.close();
    app = await fauxHarness(t.dir, rules, []);
    app.harness.resume();
    await app.root.waitForIdle(app.ctx);
    assert.equal(calls, 1);
    await app.close();
  } finally {
    t.cleanup();
  }
});
