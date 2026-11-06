import type { Assessment } from "@dna/sdk";

const BLOCK_CHARS = 1500;
export const EVIDENCE_CHARS = 18000;
type Evidence = Assessment["evidence"];

export function evidenceBlocks(evidence: Evidence) {
  return evidence.map(({ path, excerpt }) => ({
    path,
    blocks: Array.from({ length: Math.ceil(excerpt.length / BLOCK_CHARS) }, (_, index) => ({
      index,
      text: excerpt.slice(index * BLOCK_CHARS, (index + 1) * BLOCK_CHARS),
    })),
  }));
}

/** The model selects offsets; the tool copies original source text and retains the full document hash. */
export function selectEvidenceExcerpts(evidence: Evidence, selection: unknown): Evidence {
  if (!Array.isArray(selection) || selection.length > evidence.length)
    throw new Error("Invalid evidence excerpt selection");
  const paths = new Set<string>();
  let blocks = 0;
  return selection.map((entry) => {
    const original = evidence.find((item) => item.path === entry?.path);
    if (
      !original ||
      paths.has(original.path) ||
      !Array.isArray(entry.blocks) ||
      !entry.blocks.length
    )
      throw new Error("Select unique, verified evidence paths and nonempty block lists");
    paths.add(original.path);
    const indices = [...new Set<number>(entry.blocks)].sort((a, b) => a - b);
    blocks += indices.length;
    if (
      blocks > EVIDENCE_CHARS / BLOCK_CHARS ||
      indices.some(
        (index) =>
          !Number.isInteger(index) || index < 0 || index * BLOCK_CHARS >= original.excerpt.length,
      )
    )
      throw new Error("Evidence excerpt blocks exceed the reading budget or document bounds");
    const ranges = indices.map((index) => ({
      start: index * BLOCK_CHARS,
      end: Math.min((index + 1) * BLOCK_CHARS, original.excerpt.length),
    }));
    return {
      ...original,
      ranges,
      excerpt: ranges
        .map((range) => original.excerpt.slice(range.start, range.end))
        .join("\n[... omitted context ...]\n"),
    };
  });
}
