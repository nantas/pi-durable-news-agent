import assert from "node:assert/strict";
import { test } from "node:test";
import { calibrationUserMessage } from "../src/agents/tools/calibration.ts";

test("calibration reads original user text from its own invocation ancestry, ignoring later input", async () => {
  const original = "工具分改为60，因为我已熟悉。不要改分类。";
  const records = new Map<number, any>([
    [5, { kind: "pi.assistant", head: 4 }],
    [4, { kind: "pi.tool-result", head: 3 }],
    [
      3,
      {
        kind: "pi.user",
        model: [
          {
            role: "user",
            content: JSON.stringify({ userMessage: original, cardContext: { id: 1 } }),
          },
        ],
      },
    ],
    [9, { kind: "pi.user", model: [{ role: "user", content: "Later unrelated message" }] }],
  ]);
  const api: any = {
    taskId: 6,
    conversationId: 1,
    getTask: async () => ({ input: { assistant: 5 } }),
    commit: async (fn: Function) =>
      fn({
        entry: async (id: number) => records.get(id),
        scanEntries: async (query: any) => ({
          items: [...records.entries()]
            .filter(([id]) => id <= query.maxEntryId)
            .sort(([a], [b]) => b - a)
            .map(([, value]) => value),
        }),
      }),
  };
  assert.equal(await calibrationUserMessage(api, {} as any), original);
  records.delete(3);
  await assert.rejects(calibrationUserMessage(api, {} as any), /original user message/);
});
