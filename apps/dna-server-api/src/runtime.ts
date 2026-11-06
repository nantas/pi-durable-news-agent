// Open everything the server runs: dna.sqlite, the Judge, search, images, the durable Harness with both agents,
// the telemetry projector, and the root news-desk conversation. Close it all on shutdown.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Conversation, SubmissionId } from "@earendil-works/pi-durable";
import type { Context } from "@earendil-works/chord";
import { JevClient, type Decide } from "@dna/jev";
import type { CompactionState } from "@dna/sdk";
import {
  createModelCatalog,
  openPiModelCatalog,
  DEFAULT_POINTS,
  fit,
  fits,
  installScriptedFaux,
  openDurableHarness,
  startProjector,
  toPolicy,
  type CompactionPoints,
  type DurableHarness,
} from "@dna/durable-agent";
import { createLogger, type Logger } from "@dna/sdk/node";
import { ensureAssessmentBatch } from "./news/assessment-task.ts";
import { createAgents, type Agents } from "./agents/index.ts";
import { fauxRules } from "./agents/faux-script.ts";
import type { Config } from "./config.ts";
import { openStore } from "./db/store.ts";
import type { Deps } from "./deps.ts";
import { Bus } from "./events.ts";
import { runCommand } from "./news/commands.ts";
import { Dates } from "./news/dates.ts";
import { fixtureCommand, fixtureDecide, fixtureHttp } from "./news/fixtures.ts";
import { Judge } from "./news/hfs.ts";
import { liveHttp } from "./news/http.ts";
import { deepResearchSetting } from "./news/deep-research.ts";
import { Images } from "./news/images.ts";
import { Quick } from "./news/quick.ts";
import { Schedule } from "./news/schedule.ts";
import { closeStalledSweeps, withdrawStuckSweeps } from "./news/sweep.ts";
import { SearchService } from "./news/search/index.ts";

export interface CompactionSetting {
  points: CompactionPoints;
  enabled: boolean;
}

export interface App extends Deps {
  harness: DurableHarness;
  ctx: Context;
  agents: Agents;
  main: Conversation;
  compaction: CompactionSetting;
  /** The main agent's model id and context window, read live. */
  mainModel(): Promise<{ id: string; window: number }>;
  setCompaction(next: Partial<CompactionSetting>): CompactionSetting;
  /** The points, the switch, and the main model's window the points must fit. */
  compactionState(): CompactionState;
  /** Re-read the main model's window after a model change; refit saved points that no longer fit. */
  refreshModel(): Promise<{ id: string; window: number }>;
  readonly startedAt: number;
  close(): Promise<void>;
}

function decideFor(config: Config): Decide {
  if (config.jevBackend === "fixture") return fixtureDecide();
  const client =
    config.jevBackend === "auto" ? new JevClient() : new JevClient({ provider: config.jevBackend });
  return (state, questions, opts) => client.systemOne(state, questions, opts);
}

export async function openApp(config: Config, options: { log?: Logger } = {}): Promise<App> {
  mkdirSync(config.dataDir, { recursive: true });
  const log = options.log ?? createLogger("api").child({ device: config.device });
  const modelIds = [
    config.model,
    config.researchModel,
    config.quickModel,
    config.coverageModel,
    config.deepResearchModel,
    config.summaryModel,
  ];
  if (config.provider !== "faux" && modelIds.some((id) => !id))
    throw new Error("Configure every model role explicitly in local .env");
  const catalog =
    config.provider === "faux"
      ? createModelCatalog({
          provider: "faux",
          installFaux: (models) => installScriptedFaux(models, fauxRules()),
        })
      : await openPiModelCatalog(config.model, modelIds);
  const decide = decideFor(config);
  const store = openStore(config.dataDir, config.configDir);
  const http = config.searchMode === "fixture" ? fixtureHttp() : liveHttp(log);
  const migrateRoles = config.provider === "pi" && !store.settings.get("piRolesInitialized", false);
  if (migrateRoles) {
    store.settings.set("quick", {
      ...store.settings.get("quick", { thinkingLevel: "off" }),
      model: config.quickModel,
    });
    store.settings.set("deepResearch", {
      ...deepResearchSetting(store),
      model: config.deepResearchModel,
    });
  }
  if (migrateRoles) {
    store.settings.set("coverageModel", { model: config.coverageModel, thinkingLevel: "off" });
    store.settings.set("summaryModel", { model: config.summaryModel, thinkingLevel: "off" });
    store.settings.set("researchModel", config.researchModel);
  }
  const judge = new Judge({
    decide,
    store,
    log,
    dir: join(config.promptsDir, "jev"),
  });
  const search = new SearchService(
    { http, store, log },
    {
      mode: config.searchMode,
      firecrawlKey: config.firecrawlKey,
      sweepCap: config.sweepCredits,
      dailyCap: config.dailyCredits,
    },
  );
  const images = new Images({
    store,
    http,
    offline: config.provider === "faux" || config.searchMode === "fixture",
  });
  const bus = new Bus();
  const quick = new Quick({ catalog, store, log, model: config.quickModel });
  const coverage = new Quick({
    catalog,
    store,
    log,
    model: config.coverageModel,
    key: "coverageModel",
    maxTokens: 4096,
  });
  const summary = new Quick({
    catalog,
    store,
    log,
    model: config.summaryModel,
    key: "summaryModel",
    maxTokens: 8192,
  });
  const dates = new Dates({ http, store, log, quick });
  const deps: Deps = {
    run: config.provider === "faux" ? fixtureCommand : runCommand,
    config,
    log,
    store,
    bus,
    judge,
    search,
    images,
    http,
    catalog,
    quick,
    coverage,
    summary,
    dates,
    schedule: new Schedule({ store, cronSchedule: config.cronSchedule }),
  };
  const agents = createAgents(deps);

  const compaction: CompactionSetting = store.settings.get("compaction", {
    points: DEFAULT_POINTS,
    enabled: true,
  });
  let window = 1_000_000;
  const harness = await openDurableHarness({
    dbPath: join(config.dataDir, "agent.sqlite"),
    catalog,
    extensions: agents.all,
    defaults: agents.defaults,
    compaction: () => toPolicy(window, compaction.points, compaction.enabled),
    logger: log,
  });
  const stopProjector = startProjector(harness.harness, store.telemetry, log);
  const ctx = harness.ctx;
  const main = await harness.harness.root(ctx, {
    agent: { model: catalog.defaultModel, thinkingLevel: "low" },
  });
  if (migrateRoles) {
    const { configure } = await import("@earendil-works/pi-durable");
    const conversations = await harness.harness.commit(async (tx) => {
      const ids = [];
      let cursor;
      do {
        const page = await tx.scanConversations({}, 100, cursor);
        ids.push(...page.items.map((item) => item.id));
        cursor = page.next;
      } while (cursor !== undefined);
      return ids;
    }, ctx);
    for (const id of conversations) {
      const conversation = await harness.harness.conversation(id, ctx);
      if (!conversation) continue;
      const agent = await conversation.agent(ctx);
      const names = agent.extensions.map((extension) => extension.name);
      const model = names.includes("deep-research")
        ? config.deepResearchModel
        : names.includes("news-researcher")
          ? config.researchModel
          : config.model;
      await harness.harness.commit((tx) => configure(tx, id, { model: catalog.ref(model) }), ctx);
    }
    store.settings.set("piRolesInitialized", true);
  }
  const mainModel = async () => {
    const agent = await main.agent(ctx);
    const ref = agent.model ?? catalog.defaultModel;
    const id = catalog.provider === "faux" ? ref.modelId : `${ref.provider}/${ref.modelId}`;
    return { id, window: catalog.info(id)?.contextWindow ?? 1_000_000 };
  };
  window = (await mainModel()).window;
  if (!fits(window, compaction.points)) {
    compaction.points = fit(window, compaction.points);
    store.settings.set("compaction", compaction);
  }
  const pendingSweeps = store.db
    .prepare(`SELECT DISTINCT c.sweep_id AS id FROM cards c JOIN items i ON i.id=c.item_id
    JOIN assessments a ON a.id=i.current_assessment_id WHERE c.sweep_id IS NOT NULL AND json_extract(a.payload_json, '$.status')='pending'`)
    .all() as { id: number }[];
  await harness.harness.commit(async (tx) => {
    for (const sweep of pendingSweeps)
      await ensureAssessmentBatch(tx, main.id, sweep.id, agents.assessmentTask);
  }, ctx);
  harness.harness.resume();

  const stallTimer = setInterval(() => {
    closeStalledSweeps({ store, log, config, bus });
    withdrawStuckSweeps(
      { store, log, bus },
      {
        mainId: main.id as number,
        withdraw: (id) => harness.harness.abortSubmission(id as SubmissionId, ctx, main.id),
      },
    ).catch((error) => log.warn("sweep.withdraw_failed", { error: String(error) }));
  }, 60_000);
  stallTimer.unref();

  log.info("app.opened", {
    device: config.device,
    provider: config.provider,
    model: (await mainModel()).id,
    searchMode: search.mode,
    jev: config.jevBackend,
    dataDir: config.dataDir,
    mainConversation: main.id,
  });

  return {
    ...deps,
    harness,
    ctx,
    agents,
    main,
    compaction,
    mainModel,
    startedAt: Date.now(),
    compactionState: () => ({ ...compaction.points, enabled: compaction.enabled, window }),
    async refreshModel() {
      const model = await mainModel();
      window = model.window;
      if (!fits(window, compaction.points)) {
        const before = compaction.points;
        compaction.points = fit(window, compaction.points);
        store.settings.set("compaction", compaction);
        log.warn("agent.compaction_refit", {
          model: model.id,
          window,
          before,
          after: compaction.points,
        });
      }
      return model;
    },
    setCompaction(next) {
      if (next.points) compaction.points = next.points;
      if (next.enabled !== undefined) compaction.enabled = next.enabled;
      store.settings.set("compaction", compaction);
      log.info("agent.compaction_set", { ...compaction.points, enabled: compaction.enabled });
      return { ...compaction };
    },
    async close() {
      clearInterval(stallTimer);
      stopProjector();
      await harness.close();
      store.close();
      log.info("app.closed", {});
    },
  };
}
