import { defineTask, type Tx, type ConversationId } from "@earendil-works/pi-durable";
import type { Deps } from "../deps.ts";
import { coverageSnapshot } from "./coverage.ts";
import { assessIncremental } from "./incremental.ts";

export interface AssessmentBatch {
  sweepId: number;
}
export function batchItems(deps: Deps, sweepId: number): number[] {
  return (
    deps.store.db
      .prepare(
        "SELECT DISTINCT item_id FROM cards WHERE sweep_id=? AND item_id IS NOT NULL ORDER BY item_id",
      )
      .all(sweepId) as { item_id: number }[]
  ).map((r) => r.item_id);
}
function unknown(deps: Deps, itemId: number, reason: string) {
  const current = deps.store.news.assessment(itemId);
  if (!current) return;
  const { id: _id, ...input } = current;
  delete input.scores;
  deps.store.news.saveAssessment({ ...input, status: "unknown", reason });
  for (const cardId of deps.store.news.cardIdsForItem(itemId))
    deps.bus.publish({ type: "feed.card_updated", card: deps.store.news.card(cardId)! });
}

type State =
  | { phase: "start" }
  | { phase: "assess"; snapshot: string; itemIds: number[]; cursor: number };
export function createAssessmentTask(deps: Deps, assess = assessIncremental) {
  return defineTask<AssessmentBatch, State, { assessed: number }>({
    name: "dna.assessment-batch",
    version: 1,
    initial: () => ({ phase: "start" }),
    phases: {
      start: async (task, runtime, ctx) => {
        const itemIds = batchItems(deps, task.input.sweepId);
        let snapshot: string;
        try {
          if (!deps.config.wikiDir) throw new Error("DNA_WIKI_DIR is not configured");
          snapshot = coverageSnapshot(deps.config.wikiDir);
        } catch (error) {
          for (const id of itemIds) unknown(deps, id, String(error));
          await runtime.commit(
            () => ({
              status: "terminal",
              outcome: { status: "completed", result: { assessed: 0 } },
            }),
            ctx,
          );
          return;
        }
        await runtime.commit(
          () => ({
            status: "running",
            checkpoint: { phase: "assess", snapshot, itemIds, cursor: 0 },
          }),
          ctx,
        );
      },
      assess: async (task, runtime, ctx) => {
        if (task.state.checkpoint.phase !== "assess") return;
        const { itemIds, snapshot, cursor } = task.state.checkpoint;
        if (cursor < itemIds.length) {
          try {
            await assess(deps, itemIds[cursor], { snapshot });
          } catch (error) {
            unknown(deps, itemIds[cursor], String(error));
          }
          await runtime.commit(
            () => ({
              status: "running",
              checkpoint: {
                ...task.state.checkpoint,
                phase: "assess",
                snapshot,
                itemIds,
                cursor: cursor + 1,
              },
            }),
            ctx,
          );
          return;
        }
        try {
          if (coverageSnapshot(deps.config.wikiDir!) !== snapshot)
            throw new Error("Coverage changed during the batch; request a fresh assessment");
        } catch (error) {
          for (const id of itemIds) unknown(deps, id, String(error));
        }
        await runtime.commit(
          () => ({
            status: "terminal",
            outcome: { status: "completed", result: { assessed: itemIds.length } },
          }),
          ctx,
        );
      },
    },
    abort: async (task, runtime, ctx) => {
      for (const id of batchItems(deps, task.input.sweepId))
        if (deps.store.news.assessment(id)?.status === "pending")
          unknown(deps, id, "Assessment batch aborted");
      await runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), ctx);
    },
  });
}

export async function ensureAssessmentBatch(
  tx: Tx,
  conversationId: ConversationId,
  sweepId: number,
  task: ReturnType<typeof createAssessmentTask>,
) {
  let cursor;
  do {
    const page = await tx.scanTasks({ conversationId, kind: "dna.assessment-batch" }, 100, cursor);
    if (page.items.some((task) => (task.input as unknown as AssessmentBatch).sweepId === sweepId))
      return;
    cursor = page.next;
  } while (cursor);
  await tx.createTask(
    task,
    { sweepId },
    { ownership: { kind: "conversation" }, conversationId, background: true },
  );
}
