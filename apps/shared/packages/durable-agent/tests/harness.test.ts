import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { createModelCatalog, installScriptedFaux, say } from "../src/index.ts";
import { ask, fauxHarness, tempDir } from "./helpers.ts";

test("production catalogs require explicit Pi role models", () => {
  assert.throws(() => createModelCatalog({ provider: "pi" }), /explicit role models/);
  const models = createModelCatalog({
    provider: "faux",
    installFaux: (models) => installScriptedFaux(models, []),
  }).models;
  const catalog = createModelCatalog({
    provider: "pi",
    runtime: models,
    defaultModel: "faux/faux-haiku",
    modelIds: ["faux/faux-haiku"],
  });
  assert.deepEqual(catalog.defaultModel, { provider: "faux", modelId: "faux-haiku" });
  assert.equal(catalog.list().length, 1);
  assert.throws(() => catalog.ref("another/model"), /Unknown model/);
  assert.throws(
    () =>
      createModelCatalog({
        provider: "pi",
        runtime: models,
        defaultModel: "missing/model",
        modelIds: ["missing/model"],
      }),
    /not registered/,
  );
});

test("the harness stores in WAL, answers on the faux model, and offers no bash or file tools", async () => {
  const t = tempDir();
  try {
    const { ctx, root, close } = await fauxHarness(
      t.dir,
      [(turn) => say(`hello ${turn.lastUser}`)],
      [],
    );
    const settled = await ask(root, ctx, "world");
    assert.equal(settled.status, "done");
    const agent = await root.agent(ctx);
    assert.deepEqual(
      agent.tools.map((x) => x.name),
      [],
    );
    const db = new DatabaseSync(join(t.dir, "agent.sqlite"));
    assert.equal((db.prepare("PRAGMA journal_mode").get() as any).journal_mode, "wal");
    db.close();
    await close();
  } finally {
    t.cleanup();
  }
});

test("a second process cannot open the same agent database", async () => {
  const t = tempDir();
  try {
    const first = await fauxHarness(t.dir, [], []);
    const other = spawnSync(
      process.execPath,
      ["--import", "tsx", join(import.meta.dirname, "fixtures/host.ts"), t.dir, "resume"],
      { encoding: "utf8", env: { ...process.env, NODE_NO_WARNINGS: "1" } },
    );
    assert.notEqual(other.status, 0);
    assert.match(other.stderr, /already owned by process/);
    await first.close();
  } finally {
    t.cleanup();
  }
});
