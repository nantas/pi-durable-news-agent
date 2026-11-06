import { join } from "node:path";
import * as schema from "@earendil-works/pi-schema";
import type { AgentChange } from "@earendil-works/pi-durable";
import { defineAppTool, loadPrompt, spawnSubagents, toolError, toolText } from "@dna/durable-agent";
import { StoryMatcher } from "../../news/stories.ts";
import type { Deps } from "../../deps.ts";

export const MAX_BATCHES = 4;
export const MAX_PER_BATCH = 4;

export function researchItems(deps: Deps, child: () => AgentChange) {
  return defineAppTool({
    name: "research_items",
    returns:
      "Text: each batch's findings per item from its news-researcher subagent, and any researcher that did not finish.",
    description: `Send up to ${MAX_BATCHES} batches of up to ${MAX_PER_BATCH} item ids to news-researcher subagents that run in parallel. Each verifies claims with jev and reports findings. Returns one short finding per item.`,
    parameters: schema.obj({
      sweep_id: schema.int(),
      batches: schema.arr(
        schema.obj({
          item_ids: schema.arr(schema.int(), { minItems: 1, maxItems: MAX_PER_BATCH }),
          focus: schema.opt(
            schema.str({ description: "What to check, for example versions and availability" }),
          ),
        }),
        { minItems: 1, maxItems: MAX_BATCHES },
      ),
    }),
    replay: "safe",
    execute: async (args, api, ctx) => {
      const ids = args.batches.flatMap((b) => b.item_ids);
      const items = deps.store.news.items(ids);
      const missing = ids.filter((id) => !items.some((i) => i.id === id));
      if (missing.length)
        return toolError(`No items ${missing.map((m) => `#${m}`).join(", ")}.`, [
          "Use item ids returned by run_news_sweep.",
        ]);
      for (const item of items)
        if (item.status === "candidate")
          deps.store.news.updateItem(item.id, { status: "researching" });
      const agentsDir = join(deps.config.promptsDir, "agents");
      const specs = args.batches.map((batch) => ({
        prompt: loadPrompt(agentsDir, "news-researcher", "USER_PROMPT_research.md", {
          sweep_id: args.sweep_id,
          items: batch.item_ids
            .map((id) => {
              const item = items.find((i) => i.id === id)!;
              const related = deps.store.news.reviewMatches(item.id);
              return `#${item.id} ${item.title} (${item.sourceName ?? "web"}) ${item.url}${related.length ? `\nPossible overlap to investigate: ${related.map((r) => `#${r.id} ${r.title} ${r.url}`).join("; ")}` : ""}`;
            })
            .join("\n"),
          focus:
            batch.focus ?? "claims, versions, dates, availability and what an engineer should do",
        }),
        agent: child(),
      }));
      const results = await spawnSubagents(api, ctx, specs, {
        requestPrefix: `research:${api.taskId}`,
        concurrency: MAX_BATCHES,
      });
      await api.details({ children: results.map((r) => r.conversationId) }, ctx);
      const matcher = new StoryMatcher(deps);
      const relationships: string[] = [];
      for (const id of ids) {
        const item = deps.store.news.item(id)!;
        if (!item.lastError?.startsWith("Story relationship uncertain")) continue;
        const matches = deps.store.news.reviewMatches(id);
        if (matches.length)
          relationships.push(
            `#${id} relationship after research: ${await matcher.classify(item, matches, args.sweep_id, true)}`,
          );
      }
      const lines = ids.map((id) => {
        const f = deps.store.news.findings(id).at(-1);
        if (!f) return `#${id} no findings reported`;
        const supported = f.claimSupport.filter((c) => c.supported >= 0.7).length;
        return `#${id} ${f.actionability ?? "unknown"} actionability: ${f.summary.slice(0, 300)}${f.claimSupport.length ? ` (${supported} of ${f.claimSupport.length} claims supported)` : ""}`;
      });
      const failed = results.filter((r) => r.status !== "done");
      return toolText(
        `${[...lines, ...relationships].join("\n")}${failed.length ? `\n${failed.length} researcher${failed.length > 1 ? "s" : ""} did not finish: ${failed.map((f) => f.reason).join(", ")}` : ""}`,
        { children: results.map((r) => r.conversationId) },
      );
    },
  });
}
