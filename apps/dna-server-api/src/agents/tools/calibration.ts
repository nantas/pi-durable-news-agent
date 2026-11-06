import type { EntryId, ToolExecutionApi } from "@earendil-works/pi-durable";
import type { Context } from "@earendil-works/chord";
import * as schema from "@earendil-works/pi-schema";
import { defineAppTool, toolText } from "@dna/durable-agent";
import type { Deps } from "../../deps.ts";
import {
  DOMAINS,
  saveCalibration,
  calibrationExamples,
  calibrationStats,
} from "../../news/calibration.ts";

export async function calibrationUserMessage(api: ToolExecutionApi, ctx: Context): Promise<string> {
  const task = await api.getTask(api.taskId, ctx);
  const input = task?.input as { assistant?: number } | undefined;
  return api.commit(async (tx) => {
    if (input?.assistant === undefined) throw new Error("Missing calibration invocation context");
    const assistant = await tx.entry(input.assistant as EntryId);
    let cursor;
    do {
      const page = await tx.scanEntries(
        {
          conversationId: api.conversationId,
          maxEntryId: input.assistant as EntryId,
          minEntryId: assistant?.head,
          order: "descending",
        },
        100,
        cursor,
      );
      for (const entry of page.items) {
        const message = entry.model?.[0];
        if (entry.kind !== "pi.user" || message?.role !== "user") continue;
        const text =
          typeof message.content === "string"
            ? message.content
            : message.content
                .filter((block) => block.type === "text")
                .map((block) => block.text)
                .join("");
        try {
          const context = JSON.parse(text);
          if (typeof context?.userMessage === "string") return context.userMessage;
        } catch {}
        return text;
      }
      cursor = page.next;
    } while (cursor !== undefined);
    throw new Error("Cannot locate the original user message for calibration");
  }, ctx);
}

export function calibrateScore(deps: Deps) {
  return defineAppTool({
    name: "calibrate_score",
    description:
      "仅在用户明确给出评分、分类或知识域修正及理由时保存并回显；含糊表述先追问，不能推断用户想要的分数。保留用户原话。",
    returns: "JSON: saved feedback id and the explicit user correction.",
    parameters: schema.obj({
      card_id: schema.int(),
      assessment_id: schema.int(),
      note: schema.str(),
      reason: schema.str(),
      scores: schema.opt(
        schema.obj({
          design: schema.opt(schema.num({ minimum: 0, maximum: 100 })),
          tools: schema.opt(schema.num({ minimum: 0, maximum: 100 })),
          reference: schema.opt(schema.num({ minimum: 0, maximum: 100 })),
        }),
      ),
      applies: schema.opt(
        schema.obj({
          design: schema.opt(schema.bool()),
          tools: schema.opt(schema.bool()),
          reference: schema.opt(schema.bool()),
        }),
      ),
      domains: schema.opt(schema.arr(schema.union(DOMAINS.map((d) => schema.lit(d))))),
    }),
    replay: "safe",
    execute: async (args, api, ctx) => {
      // The model may shorten or paraphrase note; preserve the invocation's original user text.
      const note = await calibrationUserMessage(api, ctx);
      const corrected = { scores: args.scores, applies: args.applies, domains: args.domains };
      const id = saveCalibration(deps.store, {
        cardId: args.card_id,
        assessmentId: args.assessment_id,
        conversationId: Number(api.conversationId),
        callId: String(api.taskId),
        note,
        reason: args.reason,
        corrected,
      });
      deps.bus.publish({ type: "feed.card_updated", card: deps.store.news.card(args.card_id)! });
      return toolText(JSON.stringify({ id, corrected }));
    },
  });
}
export function readCalibration(deps: Deps) {
  return defineAppTool({
    name: "read_calibration",
    description: "读取相关成对校准示例和分类漏标、多标、MAE、Bias；不会自动修改评分规则。",
    returns: "JSON: paired examples and calibration error statistics.",
    parameters: schema.obj({ item_id: schema.opt(schema.int()) }),
    replay: "safe",
    execute: async (args) => {
      const examples = calibrationExamples(
        deps.store,
        args.item_id ? (deps.store.news.item(args.item_id) ?? {}) : {},
      );
      return toolText(
        JSON.stringify({ examples: examples.slice(0, 6), stats: calibrationStats(examples) }),
      );
    },
  });
}
