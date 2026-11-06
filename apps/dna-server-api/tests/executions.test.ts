import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { bootServer, idle, settledSweep, type Booted } from "./server.ts";

let s: Booted;
let sweepId: number;
before(async () => {
  s = await bootServer();
  const started = await s.cron.newsSweep({ requestId: "exec:1" });
  sweepId = started.data.sweep!.id;
  await settledSweep(s.client, sweepId);
  await idle(s.client);
  await new Promise((r) => setTimeout(r, 1500));
});
after(() => s.cleanup());

test("a tool call detail carries timings, tokens, cost, context and its paid calls", async () => {
  const sweep = await s.client.sweep(sweepId);
  const rows = sweep.toolCalls as { id: number; toolName: string; isError: boolean }[];
  const present = rows.find((r) => r.toolName === "present_news" && !r.isError)!;
  const detail = await s.client.toolCall(present.id);
  assert.equal(typeof detail.startedAt, "number");
  assert.equal(typeof detail.endedAt, "number");
  assert.equal(typeof detail.durationMs, "number");
  assert.ok(detail.endedAt! >= detail.startedAt!);
  assert.equal(typeof detail.toolCostUsd, "number");
  assert.ok(detail.contextTokens! > 0);
  assert.ok(detail.generation, "the generation that asked for it");
  assert.ok(
    detail.generation!.inputTokens +
      detail.generation!.cacheReadTokens +
      detail.generation!.cacheWriteTokens >
      0 && detail.generation!.outputTokens > 0,
  );
  assert.equal(typeof detail.generation!.costUsd, "number");

  const jevRow = rows.find((r) => r.toolName === "jev_classify")!;
  const jev = await s.client.toolCall(jevRow.id);
  assert.equal(jev.jevCalls.length, 1);
  assert.equal(jev.jevCalls[0].command, "hfs");

  const research = await s.client.toolCall(rows.find((r) => r.toolName === "research_items")!.id);
  assert.equal(research.childRuns.length, 2, "both research subagent runs");
});

test("a run detail nests its subagents, and usage totals match the rows", async () => {
  const runs = await s.client.runs({ sweepId });
  const desk = runs.find((r) => r.agent === "news-desk")!;
  const detail = await s.client.run(desk.runEntryId);
  assert.equal(detail.children.length, 2);
  assert.ok(detail.generationRows.length >= 5);
  assert.ok(detail.toolCallRows.every((t) => t.isError || typeof t.durationMs === "number"));

  const all = await s.client.runs({ limit: 200 } as never);
  const everyRun = [
    ...all,
    ...(await Promise.all(all.map((r) => s.client.run(r.runEntryId)))).flatMap((d) => d.children),
  ];
  const seen = new Map(everyRun.map((r) => [r.runEntryId, r]));
  const [today] = (await s.client.usage(1)).slice(-1);
  assert.equal(
    today.tokensOut,
    [...seen.values()].reduce((n, r) => n + r.tokensOut, 0),
  );
  const sweeps = await s.client.sweeps();
  assert.equal(
    today.jevCalls,
    sweeps.reduce((n, x) => n + (x.cost?.jevCalls ?? 0), 0),
  );
  assert.equal(today.sweeps, 1);
});

test("/v1/logs filters by sweep and level", async () => {
  const lines = await s.client.logs({ sweepId, limit: 500 });
  assert.ok(lines.length >= 3);
  assert.ok(lines.every((l) => l.sweepId === sweepId));
  assert.ok(lines.some((l) => l.event === "sweep.started"));
  const warns = await s.client.logs({ level: "warn" });
  assert.ok(warns.every((l) => l.level === "warn" || l.level === "error" || l.level === "fatal"));
  const requests = await s.client.logs({ limit: 5 });
  assert.ok(requests.length <= 5);
  assert.ok(
    !JSON.stringify(await s.client.logs({ limit: 500 })).includes(s.tokens.client),
    "tokens never reach the logs",
  );
  const all = await s.client.logs({ limit: 500 });
  assert.ok(
    all.every((l, i) => i === 0 || l.ts >= all[i - 1].ts),
    "merged newest last",
  );
  assert.ok(
    all.every((l) => typeof l.app === "string" && l.app.length > 0),
    "each line names its app",
  );
  const exact = await s.client.logs({ levels: "info", apps: "api", limit: 500 });
  assert.ok(exact.length > 0 && exact.every((l) => l.level === "info" && l.app === "api"));
  await assert.rejects(s.client.logs({ levels: "loud" }), /levels must list/);
});

test("the agent state carries all-time spend: model, jev and images add up to the total", async () => {
  const agent = await s.client.agent();
  const { modelUsd, jevUsd, imageUsd, totalUsd } = agent.spend;
  assert.ok([modelUsd, jevUsd, imageUsd, totalUsd].every((n) => typeof n === "number" && n >= 0));
  assert.ok(Math.abs(totalUsd - (modelUsd + jevUsd + imageUsd)) < 1e-9);
});
