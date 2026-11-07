import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { coverageSnapshot, lookupMaterial, readCoverageEvidence } from "../src/news/coverage.ts";
import { assessIncremental, parseEvidenceJson } from "../src/news/incremental.ts";
import { fauxApp } from "./helpers.ts";
import type { Judge } from "../src/news/hfs.ts";

function wiki() {
  const dir = mkdtempSync(join(tmpdir(), "dna-coverage-"));
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
  writeFileSync(
    join(dir, "10-wiki/design.md"),
    "Design evidence\nhttps://example.com/material?utm_source=fixture\n",
  );
  return dir;
}

test("coverage snapshot includes untracked changes and rejects evidence outside its roots", () => {
  const dir = wiki();
  try {
    const first = coverageSnapshot(dir);
    assert.equal(first, coverageSnapshot(dir));
    assert.equal(lookupMaterial(dir, "https://example.com/material").length, 1);
    writeFileSync(join(dir, "10-wiki/design.md"), "Changed");
    assert.notEqual(first, coverageSnapshot(dir));
    assert.throws(() => readCoverageEvidence(dir, ["../outside.md"]));
    symlinkSync("/etc/hosts", join(dir, "10-wiki/outside.md"));
    assert.throws(() => readCoverageEvidence(dir, ["10-wiki/outside.md"]), /outside/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fixed evidence is judged, memoized and published; failed search is unknown without zero scores", async () => {
  const dir = wiki();
  const { app, cleanup } = await fauxApp({ DNA_WIKI_DIR: dir });
  try {
    const { item } = app.store.news.upsertItem({
      url: "https://example.com/material",
      title: "Design method",
      excerpt: "Reusable design evidence",
    });
    app.store.news.addCard({
      kind: "news",
      component: "headline",
      props: {},
      itemId: item.id,
      toolCallId: "coverage-fixture",
    });
    const plan = async () => [{ text: "A reusable method", queries: ["design", "设计"] }];
    let calls = 0;
    const search = {
      async search() {
        calls++;
        return { hits: [{ path: "10-wiki/design.md" }], mode: "fixture" };
      },
      close() {},
    };
    const result = await assessIncremental(app, item.id, {
      search,
      plan,
      select: async (candidates) => [...new Set(candidates.map((c) => c.path))],
    });
    assert.equal(result.status, "completed", result.reason);
    assert.equal(
      result.scores?.design,
      25,
      "JEV integrated score is used directly, without multiplying independent factors",
    );
    assert.equal(result.queries.length, 6);
    assert.equal(result.evidence.length, 1);
    assert.ok(result.jevCallId);
    assert.ok(result.judgments?.coverage_0);
    await assessIncremental(app, item.id, {
      search,
      plan,
      select: async (candidates) => [...new Set(candidates.map((c) => c.path))],
    });
    assert.equal(calls, 6);
    writeFileSync(join(dir, "10-wiki/design.md"), "Updated coverage");
    const failed = await assessIncremental(app, item.id, {
      plan,
      search: {
        async search() {
          throw new Error("offline");
        },
        close() {},
      },
    });
    assert.equal(failed.status, "unknown");
    assert.equal(failed.scores, undefined);
    assert.ok(failed.queries.every((q) => q.error));
    assert.equal(app.store.news.cardForItem(item.id)?.assessment?.id, failed.id);
  } finally {
    await cleanup();
    rmSync(dir, { recursive: true, force: true });
  }
});

function coverageChoices(judge: Judge, choices: string[], onIncremental?: () => void) {
  const run = judge.run.bind(judge);
  judge.run = async (name, vars, ref) => {
    if (name === "incremental") onIncremental?.();
    const result = await run(name, vars, ref);
    if (name === "coverage")
      for (const [index, choice] of choices.entries()) {
        const answer = result.answers[`coverage_${index}`];
        if (answer.type !== "choice") throw new Error("Expected coverage choice");
        answer.choice = choice;
        answer.probabilities = Object.fromEntries(
          Object.keys(answer.probabilities).map((key) => [key, key === choice ? 1 : 0]),
        );
      }
    return result;
  };
}

test("unknown coverage retains every claim judgment and skips incremental scoring", async () => {
  const dir = wiki();
  const { app, cleanup } = await fauxApp({ DNA_WIKI_DIR: dir });
  try {
    const { item } = app.store.news.upsertItem({
      url: "https://example.com/multi-claim-unknown",
      title: "Several claims",
      excerpt: "Material with several claims",
    });
    app.store.news.addCard({
      kind: "news",
      component: "headline",
      props: {},
      itemId: item.id,
      toolCallId: "coverage-multi-unknown",
    });
    let incrementalCalls = 0;
    coverageChoices(app.judge, ["unknown", "not_covered", "unknown"], () => {
      incrementalCalls++;
    });
    const result = await assessIncremental(app, item.id, {
      plan: async () => [
        { text: "First", queries: ["first"] },
        { text: "Second", queries: ["second"] },
        { text: "Third", queries: ["third"] },
      ],
      search: {
        async search() {
          return { hits: [{ path: "10-wiki/design.md" }], mode: "fixture" };
        },
        close() {},
      },
      select: async () => ["10-wiki/design.md"],
    });
    assert.equal(result.status, "unknown");
    assert.equal(result.reason, "Coverage unknown for claim-1, claim-3");
    assert.deepEqual(Object.keys(result.judgments ?? {}), [
      "coverage_0",
      "coverage_1",
      "coverage_2",
    ]);
    assert.equal(result.judgments?.coverage_1?.choice, "not_covered");
    assert.equal(result.scores, undefined);
    assert.equal(incrementalCalls, 0);
  } finally {
    await cleanup();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("not covered and partially covered claims continue to incremental scoring", async () => {
  const dir = wiki();
  const { app, cleanup } = await fauxApp({ DNA_WIKI_DIR: dir });
  try {
    const { item } = app.store.news.upsertItem({
      url: "https://example.com/mixed-coverage",
      title: "Mixed coverage",
      excerpt: "Material with mixed coverage",
    });
    let incrementalCalls = 0;
    coverageChoices(app.judge, ["not_covered", "partial"], () => {
      incrementalCalls++;
    });
    const result = await assessIncremental(app, item.id, {
      plan: async () => [
        { text: "First", queries: ["first"] },
        { text: "Second", queries: ["second"] },
      ],
      search: {
        async search() {
          return { hits: [{ path: "10-wiki/design.md" }], mode: "fixture" };
        },
        close() {},
      },
      select: async () => ["10-wiki/design.md"],
    });
    assert.equal(result.status, "completed", result.reason);
    assert.ok(result.scores);
    assert.equal(incrementalCalls, 1);
    assert.equal(result.judgments?.coverage_0?.choice, "not_covered");
    assert.equal(result.judgments?.coverage_1?.choice, "partial");
  } finally {
    await cleanup();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("evidence JSON accepts a single fenced value but does not extract JSON out of prose", () => {
  const plan = [{ text: "Deterministic replay", queries: ["replay", "回放"] }];
  assert.deepEqual(parseEvidenceJson(JSON.stringify(plan)), plan);
  assert.deepEqual(parseEvidenceJson("```json\n" + JSON.stringify(plan) + "\n```"), plan);
  assert.deepEqual(parseEvidenceJson('```\n["10-wiki/replay.md"]\n```'), ["10-wiki/replay.md"]);
  assert.throws(() => parseEvidenceJson("Here is the plan: " + JSON.stringify(plan)), SyntaxError);
  assert.throws(() => parseEvidenceJson("```json\n[]\n```\nextra"), SyntaxError);
});

test("a JEV failure reuses prepared evidence on retry without another model or search call", async () => {
  const dir = wiki();
  const { app, cleanup } = await fauxApp({ DNA_WIKI_DIR: dir });
  try {
    const { item } = app.store.news.upsertItem({
      url: "https://example.com/retry-evidence",
      title: "Design method",
    });
    let plans = 0;
    let searches = 0;
    const options = {
      plan: async () => {
        plans++;
        return [{ text: "A method", queries: ["design"] }];
      },
      select: async () => ["10-wiki/design.md"],
      search: {
        search: async () => {
          searches++;
          return { hits: [{ path: "10-wiki/design.md" }], mode: "fixture" };
        },
        close() {},
      },
    };
    const run = app.judge.run.bind(app.judge);
    let fail = true;
    app.judge.run = async (...args) => {
      if (fail) {
        fail = false;
        throw new Error("Transient JEV failure");
      }
      return run(...args);
    };
    const first = await assessIncremental(app, item.id, options);
    assert.equal(first.status, "unknown");
    assert.equal(first.evidencePrepared, true);
    const count = searches;
    assert.equal((await assessIncremental(app, item.id, options)).status, "completed");
    assert.equal(plans, 1);
    assert.equal(searches, count);
  } finally {
    await cleanup();
    rmSync(dir, { recursive: true, force: true });
  }
});
