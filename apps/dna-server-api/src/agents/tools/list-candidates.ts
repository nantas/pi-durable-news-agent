import * as schema from "@earendil-works/pi-schema";
import { defineAppTool, toolError, toolText } from "@dna/durable-agent";
import type { Deps } from "../../deps.ts";
import { itemLine } from "./shared.ts";

export function listCandidates(deps: Deps) {
  return defineAppTool({
    name: "list_candidates",
    returns:
      "Text: one line per candidate (id, title, source, attention and status), or that the sweep has none.",
    description:
      "List the ranked candidates of a sweep again, one line each, with research and presentation status.",
    parameters: schema.obj({ sweep_id: schema.int() }),
    replay: "safe",
    execute: async (args) => {
      if (!deps.store.sweeps.get(args.sweep_id)) return toolError(`No sweep #${args.sweep_id}.`);
      const items = deps.store.news.itemsForSweep(args.sweep_id, [
        "candidate",
        "researching",
        "classified",
        "presented",
      ]);
      if (!items.length) return toolText(`Sweep #${args.sweep_id} has no candidates.`);
      return toolText(items.map((i) => `${itemLine(i)} [${i.status}]`).join("\n"));
    },
  });
}
