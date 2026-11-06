import assert from "node:assert/strict";
import { test } from "node:test";
import { assessmentText, FeedModel, type Assessment } from "@dna/sdk";
import { tempStore } from "./helpers.ts";

test("assessment snapshots persist, retry once, and update cards without moving them", () => {
  const { store, cleanup } = tempStore();
  try {
    const { item } = store.news.upsertItem({ url: "https://example.com/design", title: "Design" });
    const { card } = store.news.addCard({
      kind: "news",
      component: "headline",
      props: {},
      itemId: item.id,
      toolCallId: "assessment-test",
    });
    const input: Omit<Assessment, "id"> = {
      itemId: item.id,
      command: "incremental",
      version: 1,
      materialHash: "material",
      coverageSnapshot: "coverage",
      status: "pending",
      readingDepth: "excerpt",
      claims: [{ id: "claim-1", text: "A design method" }],
      evidence: [
        {
          id: "evidence-1",
          path: "wiki/design.md",
          layer: "wiki",
          excerpt: "Related method",
          contentHash: "evidence",
        },
      ],
      queries: [{ claimId: "claim-1", queries: ["design"], scopes: ["wiki"] }],
    };
    const first = store.news.saveAssessment(input);
    assert.equal(assessmentText(first), "待评估");
    const completed = store.news.saveAssessment({
      ...input,
      status: "completed",
      scores: { design: 80, tools: 10, reference: 40 },
      confidence: 0.3,
      reason: "Only excerpt read",
    });
    assert.equal(first.id, completed.id);
    assert.match(assessmentText(completed), /30%/);
    const model = new FeedModel();
    model.load({ cards: [card] });
    model.apply({ type: "feed.card_updated", card: store.news.card(card.id)! });
    assert.deepEqual(
      model.state.news.map((c) => c.id),
      [card.id],
    );
    assert.deepEqual(model.card(card.id)?.assessment, completed);
    const unknown = store.news.saveAssessment({
      ...input,
      status: "unknown",
      reason: "Search failed",
    });
    assert.equal(unknown.scores, undefined);
    assert.match(assessmentText(unknown), /覆盖依据不足/);
    assert.throws(() => store.news.saveAssessment({ ...input, status: "completed" }), /requires/);
    assert.equal(
      (
        store.db.prepare("SELECT count(*) n FROM assessments WHERE version=1").get() as {
          n: number;
        }
      ).n,
      1,
    );
  } finally {
    cleanup();
  }
});

test("old schema migrates without losing items and snapshots survive reopen", async () => {
  const { mkdtempSync, readFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { openDb } = await import("../src/db/db.ts");
  const { migrate, MIGRATIONS_DIR } = await import("../src/db/migrate.ts");
  const { NewsRepo } = await import("../src/db/repos/news.ts");
  const dir = mkdtempSync(join(tmpdir(), "dna-assessment-"));
  let db = openDb(join(dir, "db.sqlite"));
  try {
    db.exec(readFileSync(join(MIGRATIONS_DIR, "001_schema.sql"), "utf8"));
    db.exec("CREATE TABLE schema_migrations(name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
    db.prepare("INSERT INTO schema_migrations VALUES (?, ?)").run(
      "001_schema.sql",
      new Date().toISOString(),
    );
    let repo = new NewsRepo(db);
    const { item } = repo.upsertItem({ url: "https://example.com/old", title: "Old" });
    assert.deepEqual(migrate(db), [
      "002_assessments.sql",
      "003_bookmarks.sql",
      "004_source_options.sql",
      "005_calibration.sql",
      "006_source_extensions.sql",
    ]);
    const saved = repo.saveAssessment({
      itemId: item.id,
      command: "incremental",
      version: 1,
      materialHash: "m",
      coverageSnapshot: "c",
      status: "unknown",
      readingDepth: "excerpt",
      claims: [],
      evidence: [],
      queries: [],
      reason: "Unavailable",
    });
    db.close();
    db = openDb(join(dir, "db.sqlite"));
    repo = new NewsRepo(db);
    assert.equal(repo.item(item.id)?.title, "Old");
    assert.deepEqual(repo.assessment(item.id), saved);
    assert.deepEqual(migrate(db), []);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Feed and card HTTP snapshots expose assessment evidence after restart", async () => {
  const { bootServer } = await import("./server.ts");
  const { openStore } = await import("../src/db/store.ts");
  const { CONFIG_DIR } = await import("./helpers.ts");
  const server = await bootServer();
  try {
    await server.stop();
    const store = openStore(server.dir, CONFIG_DIR);
    const { item } = store.news.upsertItem({ url: "https://example.com/http", title: "HTTP" });
    const { card } = store.news.addCard({
      kind: "news",
      component: "headline",
      props: {},
      itemId: item.id,
      toolCallId: "http-assessment",
    });
    const saved = store.news.saveAssessment({
      itemId: item.id,
      command: "incremental",
      version: 1,
      materialHash: "m",
      coverageSnapshot: "c",
      status: "completed",
      readingDepth: "full",
      scores: { design: 85, tools: 15, reference: 30 },
      confidence: 0.8,
      claims: [{ id: "c1", text: "Claim" }],
      evidence: [],
      queries: [],
    });
    store.close();
    await server.start();
    assert.deepEqual((await server.client.card(card.id)).card.assessment, saved);
    assert.deepEqual(
      (await server.client.feed()).items.find((c) => c.id === card.id)?.assessment,
      saved,
    );
  } finally {
    await server.cleanup();
  }
});
