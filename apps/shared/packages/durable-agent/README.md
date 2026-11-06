# @dna/durable-agent

A thin, readable layer over pi-durable 1.5.0 for building durable agents.

| Piece                                  | What it gives you                                                                                     |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `openDurableHarness()`                 | A Harness on SQLite (WAL) with retries, live compaction, a PID lock, and no bash or file tools        |
| `createModelCatalog()`                 | Explicit Pi provider/model IDs using Pi login, or free offline fixtures                               |
| `compaction.ts`                        | Background and force compaction points (defaults 100k and 200k), shared with UIs                      |
| `loadPrompt()`                         | Prompts from `prompt_engineering/agents/<agent>/*.md`, strict `{{vars}}`, Definition Of Done enforced |
| `defineAppTool()`                      | Enum fields checked before validation, so the model gets every valid value and an example call        |
| `toolError()`, `once()`, `allowOnly()` | Fixable failures, exactly-once effects through task memos, tool allow-lists                           |
| `spawnSubagents()`                     | Task-owned children run in parallel; replay finds the same children                                   |
| `observability()`                      | Hooks that report every request, response, tool call and compaction to a sink                         |
| `startProjector()`                     | Commits to telemetry rows, with native `durationMs`, `startedAt` and `endedAt`                        |
| `installScriptedFaux()`                | A rule-scripted faux model for free deterministic tests                                               |

## Build a new durable agent

Write `prompt_engineering/agents/<agent>/SYSTEM_PROMPT.md`, then define the tools and the agent:

```ts
const parameters = schema.obj({ word: schema.str() });
const execute = async ({ word }: { word: string }) => toolText(`${word}: a definition`);
const lookup = defineAppTool({ name: "lookup", description: "Define", parameters, execute });
const prompt = loadPrompt("prompt_engineering/agents", "dictionary", "SYSTEM_PROMPT.md", {});
const sections = [section("dictionary", () => prompt)];
const agent = defineExtension({ name: "dictionary", tools: [lookup], sections });
```

Open a harness, start the projector, and submit with a `requestId` so a retry never runs twice:

```ts
const catalog = await openPiModelCatalog(mainModel, explicitlyConfiguredRoleModels);
const extensions = [agent, observability(sink)];
const dbPath = "data/agent.sqlite";
const { harness, ctx } = await openDurableHarness({ dbPath, catalog, extensions });
startProjector(harness, telemetryStore);
const root = await harness.root(ctx, { agent: { model: catalog.defaultModel } });
harness.resume();
const job = await root.submit({ type: "input", content: "Define durable", requestId: "q1" }, ctx);
await job.wait(ctx);
```

Test it on the faux model with `installScriptedFaux`, and SIGKILL it like `tests/fixtures/host.ts` does.
