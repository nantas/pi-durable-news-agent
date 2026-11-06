import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createAssessmentTask } from "../src/news/assessment-task.ts";
import { assessIncremental } from "../src/news/incremental.ts";
import { fauxApp } from "./helpers.ts";

test("a batch isolates failures, replays the last checkpoint without paying twice and rejects mixed coverage", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dna-batch-"));
  execFileSync("git", ["init", "-q", dir]);
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.com",
      "commit",
      "--allow-empty",
      "-qm",
      "fixture",
    ],
    { cwd: dir },
  );
  mkdirSync(join(dir, "10-wiki"));
  writeFileSync(join(dir, "10-wiki/design.md"), "Existing design knowledge");
  const { app, cleanup } = await fauxApp({ DNA_WIKI_DIR: dir });
  try {
    const sweep = app.store.sweeps.create({
      requestId: "batch",
      trigger: "test",
      status: "running",
    });
    const ids = [1, 2].map((n) => {
      const { item } = app.store.news.upsertItem({
        sweepId: sweep.id,
        url: `https://example.com/batch-${n}`,
        title: "A design method",
      });
      app.store.news.addCard({
        kind: "news",
        component: "brief",
        props: {},
        itemId: item.id,
        sweepId: sweep.id,
        toolCallId: `batch-${n}`,
      });
      return item.id;
    });
    let planCalls = 0;
    const definition = createAssessmentTask(app, async (deps, id, options) => {
      if (id === ids[0]) throw new Error("One item failed");
      return assessIncremental(deps, id, {
        ...options,
        plan: async () => {
          planCalls++;
          return [{ text: "A design method", queries: ["design", "设计"] }];
        },
        select: async (candidates) => [...new Set(candidates.map((c) => c.path))],
        search: {
          async search() {
            return { hits: [{ path: "10-wiki/design.md" }], mode: "fixture" };
          },
          close() {},
        },
      });
    }).definition;
    let state: any = { status: "running", checkpoint: definition.initial({ sweepId: sweep.id }) };
    let crash = false;
    const runtime: any = {
      async commit(fn: () => unknown) {
        const next = await fn();
        if (crash) {
          crash = false;
          throw new Error("Crash before checkpoint");
        }
        state = next;
      },
    };
    const step = () =>
      (definition.phases as any)[state.checkpoint.phase](
        { input: { sweepId: sweep.id }, state },
        runtime,
        app.ctx,
      );
    await step();
    await step();
    assert.equal(app.store.news.assessment(ids[0])?.status, "unknown");
    crash = true;
    await assert.rejects(step(), /Crash before checkpoint/);
    assert.equal(app.store.news.assessment(ids[1])?.status, "completed");
    const calls = app.judge.ledger.calls;
    await step();
    assert.equal(app.judge.ledger.calls, calls);
    assert.equal(planCalls, 1);
    writeFileSync(join(dir, "10-wiki/design.md"), "Coverage changed");
    await step();
    assert.equal(state.status, "terminal");
    assert.ok(ids.every((id) => app.store.news.assessment(id)?.status === "unknown"));
    assert.ok(ids.every((id) => app.store.news.assessment(id)?.scores === undefined));
  } finally {
    await cleanup();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("server rank uses independent maximum value while SSE updates preserve positions until refresh", async () => {
  const { app, cleanup } = await fauxApp();
  try {
    const cards = [20, 90].map((score, index) => {
      const { item } = app.store.news.upsertItem({
        url: `https://example.com/rank-${index}`,
        title: `Design ${index}`,
      });
      const { card } = app.store.news.addCard({
        kind: "news",
        component: "brief",
        props: {},
        itemId: item.id,
        toolCallId: `rank-${index}`,
      });
      app.store.news.saveAssessment({
        itemId: item.id,
        command: "incremental",
        version: 1,
        materialHash: "m",
        coverageSnapshot: "c",
        status: "completed",
        scores: { design: score, tools: 0, reference: 0 },
        confidence: 0.8,
        readingDepth: "page",
        claims: [],
        evidence: [],
        queries: [],
      });
      return app.store.news.card(card.id)!;
    });
    const { FeedModel } = await import("@dna/sdk");
    const model = new FeedModel();
    model.load({ cards });
    assert.deepEqual(
      app.store.news.cards().map((c) => c.id),
      [cards[1].id, cards[0].id],
    );
    model.apply({ type: "feed.card_updated", card: cards[1] });
    assert.deepEqual(
      model.state.news.map((c) => c.id),
      cards.map((c) => c.id),
    );
    model.load({ cards: app.store.news.cards() });
    assert.deepEqual(
      model.state.news.map((c) => c.id),
      [cards[1].id, cards[0].id],
    );
    assert.deepEqual(
      app.store.news.cards({ before: cards[1].id, limit: 1 }).map((c) => c.id),
      [cards[0].id],
    );
  } finally {
    await cleanup();
  }
});
