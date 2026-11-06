// Component rules checked against jev scores, and the catalog rendered into the system prompt.
import { COMPONENT_SPECS, NEWS_COMPONENTS, type CardComponent, type HfsScores } from "@dna/sdk";

export interface RuleInput {
  component: CardComponent;
  props: Record<string, unknown>;
  hfs?: HfsScores;
  attention?: number;
  hasDiscussion?: boolean;
}

const filled = (v: unknown) =>
  Array.isArray(v)
    ? v.length > 0
    : typeof v === "string"
      ? v.trim().length > 0
      : v !== undefined && v !== null;

/** Why this component cannot render this item, with the alternatives, or undefined when it can. */
export function checkComponent(input: RuleInput): string | undefined {
  const spec = COMPONENT_SPECS[input.component];
  const missing = spec.required.filter((field) => !filled(input.props[field]));
  if (missing.length)
    return `${input.component} needs ${missing.join(", ")} in props. Required: ${spec.required.join(", ")}.`;
  const h = input.hfs;
  switch (input.component) {
    case "headline":
      if ((input.attention ?? 0) < 70)
        return `headline needs attention 70 or more, and this item has ${input.attention ?? 0}. Use brief.`;
      break;
    case "signal_alert":
      if (!h)
        return "signal_alert needs an hfs classification first. Call jev_classify with command hfs.";
      if (h.signal < 60)
        return `signal_alert needs a signal score of 60 or more, and jev scored this item ${h.signal}. Use brief or fact_check.`;
      break;
    case "hype_watch":
      if (!h)
        return "hype_watch needs an hfs classification first. Call jev_classify with command hfs.";
      if (h.hype < 40)
        return `hype_watch needs a hype score of 40 or more, and jev scored this item ${h.hype}. Use brief or fact_check.`;
      break;
    case "fact_check":
      if (!h)
        return "fact_check needs an hfs classification first. Call jev_classify with command hfs.";
      break;
    case "thread_pulse":
      if (!input.hasDiscussion)
        return "thread_pulse needs an item with a discussion link (Hacker News or Reddit). Use brief.";
      break;
  }
  return undefined;
}

export function componentCatalog(legacyFixtures = true): string {
  const row = (c: CardComponent) => {
    const s = COMPONENT_SPECS[c];
    return `| ${c} | ${s.use} | ${s.required.join(", ")} | ${s.rule} |`;
  };
  return [
    "News components (present_news):",
    "| component | use when | required props | rule |",
    "|---|---|---|---|",
    ...NEWS_COMPONENTS.filter(
      (component) =>
        legacyFixtures || !["signal_alert", "hype_watch", "fact_check"].includes(component),
    ).map(row),
  ].join("\n");
}
