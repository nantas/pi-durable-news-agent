// Client-side feed reducer: news cards (REST ranking, stable during SSE updates), sweeps, open taste questions, agent state and usage, from
// the REST snapshot plus feed.*, sweep, taste.question, agent.state and usage frames. Timelines are views over the
// news cards that share a timeline id.
import type { AgentState, Card, Frame, Sweep, TasteQuestion, UsageDay } from "./api.ts";
import { Emitter } from "./agent-model.ts";

export interface FeedViewState {
  news: Card[];
  sweeps: Sweep[];
  questions: TasteQuestion[];
  agent?: AgentState;
  usage?: UsageDay;
}

export class FeedModel extends Emitter {
  private cards = new Map<number, Card>();
  private sweeps = new Map<number, Sweep>();
  private questions = new Map<number, TasteQuestion>();
  state: FeedViewState = { news: [], sweeps: [], questions: [] };

  /** Merge REST pages (GET /v1/feed, /v1/sweeps, /v1/taste-questions). */
  load(data: {
    cards?: Card[];
    sweeps?: Sweep[];
    questions?: TasteQuestion[];
    agent?: AgentState;
  }) {
    if (data.cards) {
      const incoming = new Set(data.cards.map((card) => card.id));
      this.cards = new Map([
        ...data.cards.map((card) => [card.id, card] as const),
        ...[...this.cards].filter(([id]) => !incoming.has(id)),
      ]);
    }
    for (const s of data.sweeps ?? []) this.sweeps.set(s.id, s);
    for (const q of data.questions ?? []) this.questions.set(q.id, q);
    if (data.agent) this.state.agent = data.agent;
    this.rebuild();
  }

  apply(frame: Frame): boolean {
    switch (frame.type) {
      case "feed.card":
      case "feed.card_updated":
      case "ui.highlight":
        this.cards.set(frame.card.id, frame.card);
        break;
      case "sweep":
        this.sweeps.set(frame.sweep.id, frame.sweep);
        break;
      case "taste.question":
        this.questions.set(frame.question.id, frame.question);
        break;
      case "agent.state":
        this.state.agent = frame.state;
        break;
      case "usage":
        this.state.usage = frame.usage;
        break;
      case "schedule":
        if (this.state.agent)
          this.state.agent = {
            ...this.state.agent,
            schedule: frame.schedule,
            nextSweepAt: frame.schedule.nextSweepAt,
          };
        break;
      default:
        return false;
    }
    this.rebuild();
    return true;
  }

  card(id: number): Card | undefined {
    return this.cards.get(id);
  }

  /** The cards of one timeline that this model holds, in timeline order. */
  timeline(id: number): Card[] {
    return [...this.cards.values()]
      .filter((c) => c.timeline?.id === id)
      .sort((a, b) => a.timeline!.index - b.timeline!.index);
  }

  private rebuild() {
    const cards = [...this.cards.values()];
    this.state = {
      ...this.state,
      news: cards.filter((c) => c.kind === "news" && !c.hiddenFromFeed),
      sweeps: [...this.sweeps.values()].sort((a, b) => a.id - b.id),
      questions: [...this.questions.values()]
        .filter((q) => q.status === "open")
        .sort((a, b) => a.id - b.id),
    };
    this.emit();
  }
}
