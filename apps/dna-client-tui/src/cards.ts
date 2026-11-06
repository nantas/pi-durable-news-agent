// Cards as text blocks. H/F/S badges use symbols, never punctuation: ⚡ Signal 91  ✔ Facts 84  ▲ Hype 7, ranked.
import { wrapTextWithAnsi, type Component } from "@earendil-works/pi-tui";
import {
  assessmentText,
  ago,
  cleanText,
  type Card,
  type HfsCategory,
  type HfsScores,
} from "@dna/sdk";
import { cut } from "./render.ts";
import { c } from "./theme.ts";

export const SYMBOL: Record<HfsCategory, string> = { signal: "⚡", facts: "✔", hype: "▲" };
const NAME: Record<HfsCategory, string> = { signal: "Signal", facts: "Facts", hype: "Hype" };
const COLOR: Record<HfsCategory, (s: string) => string> = {
  signal: c.signal,
  facts: c.facts,
  hype: c.hype,
};

export function hfsBadges(hfs?: HfsScores): string {
  if (!hfs) return c.faint("not ranked yet");
  return hfs.ranked
    .map((r, i) => {
      const badge = `${SYMBOL[r.category]} ${NAME[r.category]} ${r.score}`;
      return i === 0 ? c.bold(COLOR[r.category](badge)) : c.muted(badge);
    })
    .join("  ");
}

const str = (props: Record<string, unknown>, key: string): string => {
  const v = props[key];
  if (typeof v === "string" || typeof v === "number") return cleanText(String(v));
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    return cleanText([o.name ?? o.title, o.text ?? o.summary ?? o.body].filter(Boolean).join(": "));
  }
  return "";
};
const list = (props: Record<string, unknown>, key: string): string[] => {
  const v = props[key];
  if (!Array.isArray(v)) return typeof v === "string" && v ? [cleanText(v)] : [];
  return v.map((x) =>
    cleanText(
      typeof x === "string"
        ? x
        : x && typeof x === "object"
          ? [(x as Record<string, unknown>).date, (x as Record<string, unknown>).text]
              .filter(Boolean)
              .join("  ")
          : String(x),
    ),
  );
};

/** The component's body as plain lines, before wrapping. */
export function cardBody(card: Card): string[] {
  const p = card.props;
  const title = str(p, "title") || cleanText(card.title);
  switch (card.component) {
    case "headline":
      return [c.bold(title), str(p, "dek")];
    case "signal_alert":
      return [
        c.bold(title),
        `${c.signal("⚡ Act on this")} ${str(p, "action")}`,
        c.muted(str(p, "why")),
      ];
    case "fact_check":
      return [
        c.bold(str(p, "claim") || title),
        c.facts(`✔ ${str(p, "verdict")}`),
        ...list(p, "evidence").map((e) => c.muted(`  ↗ ${e}`)),
      ];
    case "hype_watch":
      return [c.bold(title), `${c.hype("▲ Reality check")} ${str(p, "reality_check")}`];
    case "release":
      return [
        c.bold(`${str(p, "name") || title} ${str(p, "version")}`),
        ...list(p, "changes").map((x) => `  ✓ ${x}`),
      ];
    case "thread_pulse":
      return [c.bold(title), ...list(p, "takes").map((t) => `  ❝ ${t}`)];
    case "quote":
      return [c.italic(`❝ ${str(p, "quote")} ❞`), c.muted(str(p, "speaker"))];
    default:
      return [c.bold(title), str(p, "summary") || str(p, "dek")];
  }
}

export function cardHead(card: Card, now = Date.now()): string {
  const source = cleanText(card.sourceName ?? "Web");
  const timeline = card.timeline
    ? `  ${c.accent(`◷ timeline ${card.timeline.id} ${card.timeline.index}/${card.timeline.count}`)}`
    : "";
  return `${c.accent(`#${card.id}`)} ${c.muted(card.component)}  ${source}  ${c.faint(ago(card.publishedAt ?? card.createdAt, now))}${card.topic ? `  ${c.faint(cleanText(card.topic))}` : ""}${timeline}${card.image?.status === "pending" ? c.faint("  image generating") : ""}`;
}

export function feedbackLine(card: Card): string {
  const f = card.feedback;
  if (!f?.signal && !f?.labels.length) return "";
  return c.muted(
    `you said ${[f.signal ? `show me ${f.signal}` : "", ...f.labels.map((l) => `${SYMBOL[l]} ${NAME[l]}`)].filter(Boolean).join("  ")}`,
  );
}

export class CardBlock implements Component {
  constructor(public card: Card) {}
  render(width: number): string[] {
    const inner = Math.max(1, width - 2);
    const wrapLine = (line: string, indent = "  ") =>
      line ? wrapTextWithAnsi(line, inner).map((l) => cut(indent + l, width)) : [];
    return [
      cut(cardHead(this.card), width),
      ...cardBody(this.card).flatMap((l) => wrapLine(l)),
      ...wrapLine(assessmentText(this.card.assessment)),
      ...wrapLine(feedbackLine(this.card)),
      "",
    ];
  }
  invalidate() {}
}
