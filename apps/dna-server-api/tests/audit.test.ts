import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { auditSweep } from "../src/news/audit.ts";
import type { App } from "../src/runtime.ts";
import { fauxApp } from "./helpers.ts";

let app: App;
let cleanup: () => Promise<void>;
before(async () => ({ app, cleanup } = await fauxApp({ DNA_FIXTURE_SET: "news" })));
after(() => cleanup());

test("the audit requires a recoverable assessment for every presented card", () => {
  const store = app.store;
  const sweep = store.sweeps.create({
    requestId: "audit:news",
    trigger: "test",
    status: "running",
  });
  const [a, b] = ["a", "b"].map(
    (k) =>
      store.news.upsertItem({ sweepId: sweep.id, url: `https://example.com/${k}`, title: k }).item
        .id,
  );
  for (const itemId of [a, b])
    store.news.addCard({
      kind: "news",
      component: "brief",
      props: { title: "t", summary: "s" },
      itemId,
      toolCallId: `audit:news:${itemId}`,
      sweepId: sweep.id,
    });
  store.sweeps.update(sweep.id, { candidates: 2, status: "completed" });
  const step = "assessment for every presented item";
  const assessmentId = store.news.assessment(b)!.id;
  store.db.prepare("UPDATE items SET current_assessment_id=NULL WHERE id=?").run(b);
  assert.ok(auditSweep(store, sweep.id)!.missing.includes(step));
  store.db.prepare("UPDATE items SET current_assessment_id=? WHERE id=?").run(assessmentId, b);
  assert.ok(!auditSweep(store, sweep.id)!.missing.includes(step));
});
