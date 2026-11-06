// GET /v1/stream: one SSE stream per client. hello, then agent.snapshot and agent.batch for the main agent (plus
// any subagents the client asks for with ?conversations=), then bus frames (feed.card, sweep, taste.question),
// agent.state and usage. Pings every 15 s and ends at 2 MB buffered so a slow viewer reconnects to a fresh snapshot.
// Streams are viewers only: closing one never aborts work.
import type { Request, Response } from "express";
import { type ConversationId } from "@earendil-works/pi-durable";
import { API_VERSION, type Frame } from "@dna/sdk";
import { agentState } from "./agent-state.ts";
import { invalid } from "./errors.ts";
import type { App } from "./runtime.ts";

const MAX_BUFFER = 2_000_000;
const MAX_CONVERSATIONS = 8;

export interface Sse {
  send(frame: Frame): void;
  sendIfChanged(key: string, frame: Frame): void;
  onClose(fn: () => void): void;
  close(): void;
  readonly closed: boolean;
}

export function openSse(res: Response): Sse {
  res.status(200).set({
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  res.flushHeaders();
  res.socket?.setNoDelay(true);
  let seq = 0;
  let closed = false;
  const cleanups: (() => void)[] = [];
  const last = new Map<string, string>();
  const ping = setInterval(() => {
    if (!closed) res.write(": ping\n\n");
  }, 15_000);
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(ping);
    for (const fn of cleanups.splice(0)) {
      try {
        fn();
      } catch {}
    }
  };
  res.on("close", close);
  const send = (frame: Frame) => {
    if (closed) return;
    if (res.writableLength > MAX_BUFFER) {
      res.end();
      close();
      return;
    }
    res.write(`id: ${++seq}\nevent: ${frame.type}\ndata: ${JSON.stringify(frame)}\n\n`);
  };
  return {
    send,
    sendIfChanged(key, frame) {
      const json = JSON.stringify(frame);
      if (last.get(key) === json) return;
      last.set(key, json);
      send(frame);
    },
    onClose(fn) {
      if (closed) fn();
      else cleanups.push(fn);
    },
    close() {
      res.end();
      close();
    },
    get closed() {
      return closed;
    },
  };
}

/** Run `fn` at most once per `ms`, never concurrently, always catching up on the latest trigger. */
export function coalesce(fn: () => Promise<void>, ms: number, onError: (e: unknown) => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let again = false;
  const run = async () => {
    timer = undefined;
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      await fn();
    } catch (e) {
      onError(e);
    } finally {
      running = false;
      if (again) {
        again = false;
        trigger();
      }
    }
  };
  const trigger = () => {
    if (!timer) timer = setTimeout(() => void run(), ms);
  };
  return Object.assign(trigger, { now: run, cancel: () => timer && clearTimeout(timer) });
}

export function parseConversations(raw: unknown): number[] {
  if (raw === undefined || raw === "") return [];
  if (typeof raw !== "string") throw invalid("conversations must be a comma separated list of ids");
  const ids = [...new Set(raw.split(",").map((s) => Number(s.trim())))];
  if (ids.some((n) => !Number.isInteger(n) || n <= 0))
    throw invalid("conversations must be a comma separated list of ids");
  if (ids.length > MAX_CONVERSATIONS)
    throw invalid(`At most ${MAX_CONVERSATIONS} conversations per stream`);
  return ids;
}

/** Every open stream, so shutdown can end them before the harness closes. */
export class StreamHub {
  private readonly open = new Set<Sse>();
  closing = false;

  async serve(app: App, req: Request, res: Response): Promise<void> {
    const { harness, ctx } = app.harness;
    const extra = parseConversations(req.query.conversations);
    const ids = [app.main.id as number, ...extra.filter((id) => id !== (app.main.id as number))];
    const sse = openSse(res);
    this.open.add(sse);
    sse.onClose(() => this.open.delete(sse));
    const log = app.log.child({ stream: true });
    log.info("stream.open", { conversations: ids });
    sse.onClose(() => log.info("stream.close", { conversations: ids }));
    sse.send({
      type: "hello",
      apiVersion: API_VERSION,
      serverTime: Date.now(),
      device: app.config.device,
      mainConversationId: app.main.id as number,
    });

    for (const id of ids) {
      if (sse.closed) return;
      if (!(await harness.conversation(id as ConversationId, ctx))) continue;
      const conversation = await harness.conversation(id as ConversationId, ctx);
      if (!conversation) continue;
      const stream = await conversation.watch(ctx, { min: 1000, max: 2000 });
      const snapshot = (value: typeof stream.value) => {
        const view = JSON.parse(JSON.stringify(value));
        const live = view.docs["pi.live"] ?? {};
        return {
          type: "snapshot" as const,
          entries: view.entries,
          run: live.run,
          generation: live.generation,
          tools: live.tools ?? [],
          compactions: (live.compactions ?? []).map((c: { trigger: string }) => ({
            ...c,
            reason: c.trigger,
          })),
          inbox: (view.docs["pi.inbox"]?.items ?? []).map(
            (item: { id: number; whenBusy?: string }) => ({
              id: item.id,
              mode: item.whenBusy ?? "followUp",
            }),
          ),
          agent: view.docs["pi.agent"] ?? {},
          usage: view.docs["pi.usage"] ?? { models: {}, tools: {} },
        };
      };
      sse.send({ type: "agent.snapshot", conversationId: id, snapshot: snapshot(stream.value) });
      // shortcut: bounded full snapshots preserve the wire protocol; use view deltas for large transcripts.
      stream.start(async (call) => {
        if (call.kind === "failed") {
          sse.close();
          return;
        }
        if (call.kind === "value" && !sse.closed)
          sse.send({ type: "agent.batch", conversationId: id, events: [snapshot(call.value)] });
      });
      sse.onClose(() => void stream.stop());
    }

    sse.onClose(app.bus.subscribe((frame) => sse.send(frame)));

    const onError = (e: unknown) => log.warn("stream.update_failed", { error: String(e) });
    const state = coalesce(
      async () => {
        if (sse.closed) return;
        sse.sendIfChanged("state", { type: "agent.state", state: await agentState(app) });
        const day = new Date().toISOString().slice(0, 10);
        const today = app.store.telemetry.usage(1).find((u) => u.day === day);
        if (today) sse.sendIfChanged("usage", { type: "usage", usage: today });
      },
      500,
      onError,
    );
    const observation = harness.observeCommits({ advance: () => state(), end: () => {} });
    sse.onClose(() => observation.detach());
    sse.onClose(() => state.cancel());
    await state.now();
  }

  closeAll(): void {
    this.closing = true;
    for (const sse of [...this.open]) sse.close();
  }

  get size(): number {
    return this.open.size;
  }
}
