// The main agent's state for GET /v1/agent and the agent.state frame.
import { sumUsage, type AgentState } from "@dna/sdk";
import { deepResearchSetting } from "./news/deep-research.ts";
import type { App } from "./runtime.ts";

export async function agentState(app: App): Promise<AgentState> {
  const { harness, ctx } = app.harness;
  const agent = await app.main.agent(ctx);
  const model = await app.mainModel();
  const graph = await harness.observeTaskGraph({ advance: () => {}, end: () => {} }, ctx);
  let busy: boolean;
  try {
    busy = Object.values(graph.value.tasks).some(
      (t) => (t.conversationId as number) === (app.main.id as number) && !t.background,
    );
  } finally {
    graph.detach();
  }
  const total = sumUsage(JSON.parse(JSON.stringify(await harness.usage(ctx))));
  return {
    conversationId: app.main.id as number,
    model: model.id,
    thinkingLevel: agent.thinkingLevel ?? "low",
    quick: app.quick.setting(),
    deepResearch: deepResearchSetting(app.store, app.config.deepResearchModel),
    roles: {
      research: app.store.settings.get("researchModel", app.config.researchModel),
      coverage: app.coverage.setting().model,
      summary: app.summary.setting().model,
    },
    busy,
    contextTokens: app.store.telemetry.contextTokens(app.main.id as number),
    contextWindow: model.window,
    compaction: app.compactionState(),
    usage: {
      tokens: total.tokens,
      costUsd: total.cost,
      input: total.input,
      output: total.output,
      cacheRead: total.cacheRead,
      cacheWrite: total.cacheWrite,
    },
    spend: {
      ...app.store.telemetry.spend(),
      modelCostUnknown: app.catalog.list().some((model) => model.billingUnknown),
    },
    lastActivityAt: app.store.telemetry.lastActivityAt(),
    nextSweepAt: app.schedule.next()?.toISOString(),
    schedule: app.schedule.state(),
  };
}
