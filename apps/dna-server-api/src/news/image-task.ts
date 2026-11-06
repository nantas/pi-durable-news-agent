// dna.image: generate one card image in the background, then push the updated cards. A background task, so the
// agent's run never waits on it and an abort of the run does not cancel it.
import { defineTask } from "@earendil-works/pi-durable";
import type { Deps } from "../deps.ts";

export interface ImageInput {
  imageId: number;
  prompt: string;
}

export function createImageTask(deps: Deps) {
  return defineTask<ImageInput, { phase: "generate" }, { ok: boolean }>({
    name: "dna.image",
    version: 1,
    initial: () => ({ phase: "generate" }),
    phases: {
      generate: async (task, runtime, ctx) => {
        // Retain the task kind so pre-existing queued jobs finish without generating images.
        const ok = false;
        deps.store.news.updateImage(task.input.imageId, {
          status: "failed",
          error: "AI image generation is disabled",
        });
        for (const card of deps.store.news.cardsWithImage(task.input.imageId))
          deps.bus.publish({ type: "feed.card_updated", card });
        await runtime.commit(
          () => ({ status: "terminal", outcome: { status: "completed", result: { ok } } }),
          ctx,
        );
      },
    },
    abort: async (_task, runtime, ctx) => {
      await runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), ctx);
    },
  });
}
