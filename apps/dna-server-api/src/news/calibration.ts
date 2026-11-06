import type { ScoreCorrection } from "@dna/sdk";
import type { Store } from "../db/store.ts";
import { nowIso } from "../db/db.ts";

export const DOMAINS = [
  "game-design",
  "culture",
  "tech-workflow",
  "social-science",
  "game-operations",
] as const;
export function saveCalibration(
  store: Store,
  input: {
    cardId: number;
    assessmentId: number;
    conversationId: number;
    callId: string;
    note: string;
    reason: string;
    corrected: ScoreCorrection;
  },
): number {
  const previous = store.db
    .prepare("SELECT id FROM feedback WHERE tool_call_id = ?")
    .get(input.callId) as { id: number } | undefined;
  if (previous) return previous.id;
  const card = store.news.card(input.cardId);
  const assessment = card?.assessment;
  if (!assessment || assessment.id !== input.assessmentId)
    throw new Error("Card assessment changed; read it again before saving calibration");
  if (!input.note.trim() || !input.reason.trim())
    throw new Error("Calibration needs the user message and a reason");
  const { scores, applies, domains } = input.corrected;
  if (
    !Object.keys(scores ?? {}).length &&
    !Object.keys(applies ?? {}).length &&
    domains === undefined
  )
    throw new Error("Clarify the intended correction before saving");
  for (const [key, value] of Object.entries(scores ?? {}))
    if (
      !["design", "tools", "reference"].includes(key) ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > 100
    )
      throw new Error("Corrected scores must be between 0 and 100");
  for (const [key, value] of Object.entries(applies ?? {}))
    if (!["design", "tools", "reference"].includes(key) || typeof value !== "boolean")
      throw new Error("Invalid creative input classification");
  if (domains?.some((domain) => !(DOMAINS as readonly string[]).includes(domain)))
    throw new Error("Invalid knowledge domain");
  const result = store.db
    .prepare(`INSERT INTO feedback (card_id, note, created_at, kind, assessment_id, conversation_id, correction_json, tool_call_id)
    VALUES (?, ?, ?, 'calibration', ?, ?, ?, ?)`)
    .run(
      input.cardId,
      input.note,
      nowIso(),
      assessment.id,
      input.conversationId,
      JSON.stringify({
        model: { scores: assessment.scores, judgments: assessment.judgments },
        corrected: input.corrected,
        reason: input.reason,
      }),
      input.callId,
    );
  return Number(result.lastInsertRowid);
}

interface CalibrationExample {
  id: number;
  title: string;
  source: string;
  topic: string;
  note: string;
  correction: {
    model: {
      scores?: ScoreCorrection["scores"];
      judgments?: Record<string, { probability?: number }>;
    };
    corrected: ScoreCorrection;
    reason: string;
  };
}
export function calibrationExamples(
  store: Store,
  item: { sourceName?: string; matchedTopic?: string },
): CalibrationExample[] {
  const rows = store.db
    .prepare(`SELECT f.id, i.title, i.source_name AS source, i.matched_topic AS topic, f.note, f.correction_json
    FROM feedback f JOIN cards c ON c.id=f.card_id JOIN items i ON i.id=c.item_id
    WHERE f.kind='calibration' ORDER BY f.id DESC`)
    .all() as unknown as (Omit<CalibrationExample, "correction"> & { correction_json: string })[];
  return rows
    .map((r) => ({ ...r, correction: JSON.parse(r.correction_json) }))
    .sort((a, b) => {
      const rank = (r: CalibrationExample) =>
        Number(!!item.matchedTopic && r.topic === item.matchedTopic) * 2 +
        Number(!!item.sourceName && r.source === item.sourceName);
      return rank(b) - rank(a) || b.id - a.id;
    });
}

export function calibrationStats(examples: CalibrationExample[]) {
  const errors: number[] = [];
  let missed = 0;
  let extra = 0;
  for (const example of examples) {
    for (const key of ["design", "tools", "reference"] as const) {
      const model = example.correction.model.scores?.[key];
      const corrected = example.correction.corrected.scores?.[key];
      if (model !== undefined && corrected !== undefined) errors.push(model - corrected);
      const probability = example.correction.model.judgments?.[`${key}_applies`]?.probability;
      const applies = example.correction.corrected.applies?.[key];
      if (probability !== undefined && applies !== undefined) {
        if (probability < 0.5 && applies) missed++;
        if (probability >= 0.5 && !applies) extra++;
      }
    }
  }
  return {
    scorePairs: errors.length,
    mae: errors.length
      ? errors.reduce((sum, e) => sum + Math.abs(e), 0) / errors.length
      : undefined,
    bias: errors.length ? errors.reduce((sum, e) => sum + e, 0) / errors.length : undefined,
    missed,
    extra,
  };
}
