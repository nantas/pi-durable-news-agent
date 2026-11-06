import * as schema from "@earendil-works/pi-schema";
import { defineAppTool, toolText } from "@dna/durable-agent";
import type { Deps } from "../../deps.ts";
import { assessIncremental } from "../../news/incremental.ts";

export function assessMaterial(deps: Deps) {
  return defineAppTool({
    name: "assess_incremental",
    description:
      "只读准备 my-wiki 覆盖证据，再用 JEV 评估一条材料的三类增量价值；失败返回 unknown，不是零分。",
    parameters: schema.obj({ item_id: schema.int() }),
    returns:
      "JSON: assessment status, independent scores, confidence, evidence, query receipts and snapshot.",
    example: { item_id: 12 },
    replay: "safe",
    execute: async (args, api, ctx) => {
      const saved = await api.memo<string>("assessment", ctx);
      if (saved) return toolText(saved);
      const text = JSON.stringify(await assessIncremental(deps, args.item_id));
      await api.memo("assessment", text, ctx);
      return toolText(text);
    },
  });
}
