import assert from "node:assert/strict";
import { test } from "node:test";
import { evidenceBlocks, selectEvidenceExcerpts } from "../src/news/evidence-excerpts.ts";

const evidence = [
  {
    id: "a",
    path: "10-wiki/a.md",
    layer: "10-wiki",
    contentHash: "full-document-hash",
    excerpt: "a".repeat(1500) + "b".repeat(1500) + "c",
  },
];
test("bounded evidence copies exact source ranges, retains hashes and marks omitted context", () => {
  assert.equal(evidenceBlocks(evidence)[0].blocks.length, 3);
  const [selected] = selectEvidenceExcerpts(evidence, [{ path: evidence[0].path, blocks: [2, 0] }]);
  assert.equal(selected.contentHash, evidence[0].contentHash);
  assert.deepEqual(selected.ranges, [
    { start: 0, end: 1500 },
    { start: 3000, end: 3001 },
  ]);
  assert.equal(selected.excerpt, "a".repeat(1500) + "\n[... omitted context ...]\nc");
  for (const selection of [
    [{ path: "invented", blocks: [0] }],
    [{ path: evidence[0].path, blocks: [-1] }],
    [{ path: evidence[0].path, blocks: [3] }],
    [{ path: evidence[0].path, blocks: [0.5] }],
  ])
    assert.throws(() => selectEvidenceExcerpts(evidence, selection));
  assert.throws(
    () =>
      selectEvidenceExcerpts(
        [{ ...evidence[0], excerpt: "x".repeat(20000) }],
        [{ path: evidence[0].path, blocks: Array.from({ length: 13 }, (_, i) => i) }],
      ),
    /budget/,
  );
});
