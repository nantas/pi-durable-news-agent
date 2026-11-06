import assert from "node:assert/strict";
import { test } from "node:test";
import { assessmentText } from "@dna/sdk";
import { saveCalibration, calibrationExamples, calibrationStats } from "../src/news/calibration.ts";
import { tempStore } from "./helpers.ts";

test("calibration preserves model values, dedupes tools, merges explicit corrections and computes errors", () => {
  const { store, cleanup } = tempStore();
  try {
    const { item } = store.news.upsertItem({
      url: "https://example.com/calibrate",
      title: "Design",
      sourceName: "Example",
    });
    const { card } = store.news.addCard({
      kind: "news",
      component: "headline",
      props: {},
      itemId: item.id,
      toolCallId: "calibration",
    });
    const assessment = store.news.saveAssessment({
      itemId: item.id,
      command: "incremental",
      version: 1,
      materialHash: "m",
      coverageSnapshot: "c",
      status: "completed",
      scores: { design: 80, tools: 10, reference: 30 },
      confidence: 0.6,
      readingDepth: "page",
      claims: [],
      evidence: [],
      queries: [],
      judgments: { design_applies: { probability: 0.2 }, tools_applies: { probability: 0.8 } },
    });
    const input = {
      cardId: card.id,
      assessmentId: assessment.id,
      conversationId: 1,
      callId: "tool-1",
      note: "设计应为60，工具不适用，因为方法已掌握",
      reason: "方法已掌握",
      corrected: { scores: { design: 60 }, applies: { design: true, tools: false } },
    };
    const first = saveCalibration(store, input);
    assert.equal(saveCalibration(store, input), first);
    saveCalibration(store, {
      ...input,
      callId: "tool-2",
      corrected: { scores: { reference: 50 }, domains: ["game-design"] },
    });
    const updated = store.news.assessment(item.id)!;
    assert.equal(updated.scores?.design, 80);
    assert.deepEqual(updated.correction?.scores, { design: 60, reference: 50 });
    assert.match(assessmentText(updated), /游戏设计方法 60/);
    const examples = calibrationExamples(store, item);
    assert.equal(examples.length, 2);
    assert.deepEqual(calibrationStats(examples), {
      scorePairs: 2,
      mae: 20,
      bias: 0,
      missed: 1,
      extra: 1,
    });
    assert.throws(
      () => saveCalibration(store, { ...input, callId: "vague", corrected: {} }),
      /Clarify/,
    );
    assert.throws(
      () =>
        saveCalibration(store, { ...input, callId: "bad", corrected: { scores: { design: 101 } } }),
      /between/,
    );
    assert.throws(
      () => saveCalibration(store, { ...input, callId: "stale", assessmentId: 999 }),
      /changed/,
    );
    assert.equal(store.db.prepare("SELECT count(*) n FROM feedback").get()?.n, 2);
  } finally {
    cleanup();
  }
});
