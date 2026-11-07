import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalized, type ChoiceAnswer, type NoulAnswer, type ScoreAnswer } from "@dna/jev";
import type { Assessment } from "@dna/sdk";
import type { Deps } from "../deps.ts";
import {
  contentHash,
  COVERAGE_SCOPES,
  coverageSnapshot,
  lookupMaterial,
  openCoverageSearch,
  readCoverageEvidence,
  type CoverageSearch,
} from "./coverage.ts";
import { evidenceBlocks, EVIDENCE_CHARS, selectEvidenceExcerpts } from "./evidence-excerpts.ts";
import { calibrationExamples } from "./calibration.ts";
import { pageText } from "./page.ts";

/** Accept one JSON value, optionally enclosed in a Markdown JSON fence; reject surrounding prose. */
export function parseEvidenceJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i);
  return JSON.parse(fenced?.[1] ?? trimmed);
}

type ClaimPlan = { text: string; queries: string[] };
export async function assessIncremental(
  deps: Deps,
  itemId: number,
  options: {
    snapshot?: string;
    search?: CoverageSearch;
    plan?: (material: string) => Promise<ClaimPlan[]>;
    select?: (
      candidates: { path: string; snippet?: string; score?: number; claimId: string }[],
    ) => Promise<string[]>;
  } = {},
): Promise<Assessment> {
  const item = deps.store.news.item(itemId);
  if (!item) throw new Error(`No item ${itemId}`);
  const cwd = deps.config.wikiDir;
  if (!cwd) throw new Error("Configure DNA_WIKI_DIR in the local .env");
  const page = await pageText(deps, item, 12000);
  const material = page ?? item.excerpt ?? item.title;
  let snapshot = "unavailable";
  let snapshotError: unknown;
  try {
    snapshot = options.snapshot ?? coverageSnapshot(cwd);
  } catch (error) {
    snapshotError = error;
  }
  const input: Omit<Assessment, "id"> = {
    itemId,
    command: "incremental",
    version: deps.judge.commands.incremental.version * 1000 + deps.judge.commands.coverage.version,
    materialHash: contentHash(material),
    coverageSnapshot: snapshot,
    status: "pending",
    readingDepth: page
      ? deps.store.sources.cached(item.url)?.fetchVia === "youtube-captions"
        ? "captions (up to 12000 characters)"
        : "page (up to 12000 characters)"
      : "excerpt",
    claims: [],
    evidence: [],
    queries: [],
  };
  const previous = deps.store.news.assessment(itemId);
  if (
    previous?.status === "completed" &&
    previous.materialHash === input.materialHash &&
    previous.coverageSnapshot === input.coverageSnapshot &&
    previous.version === input.version &&
    previous.readingDepth === input.readingDepth
  )
    return previous;
  const publish = () => {
    const saved = deps.store.news.saveAssessment(input);
    for (const id of deps.store.news.cardIdsForItem(itemId))
      deps.bus.publish({ type: "feed.card_updated", card: deps.store.news.card(id)! });
    return saved;
  };
  publish();
  let search = options.search;
  try {
    if (snapshotError) throw snapshotError;
    if (
      (previous?.evidencePrepared ||
        (previous?.status === "pending" && previous.reason === "Evidence prepared")) &&
      previous.materialHash === input.materialHash &&
      previous.coverageSnapshot === input.coverageSnapshot &&
      previous.version === input.version &&
      previous.readingDepth === input.readingDepth
    ) {
      input.claims = previous.claims;
      input.evidence = previous.evidence;
      input.queries = previous.queries;
      input.exactMatches = previous.exactMatches;
      input.evidencePrepared = previous.evidencePrepared;
    } else {
      input.exactMatches = lookupMaterial(cwd, item.url);
      const plan = await (
        options.plan ??
        (async (text) => {
          const prompt = readFileSync(
            join(deps.config.promptsDir, "agents/coverage/SYSTEM_PROMPT.md"),
            "utf8",
          );
          return parseEvidenceJson(
            (await deps.coverage.ask("coverage.claims", prompt, text)).text,
          ) as ClaimPlan[];
        })
      )(material);
      if (
        !Array.isArray(plan) ||
        plan.length < 1 ||
        plan.length > 3 ||
        plan.some(
          (claim) =>
            typeof claim.text !== "string" ||
            !claim.text.trim() ||
            !Array.isArray(claim.queries) ||
            claim.queries.length < 1 ||
            claim.queries.length > 4 ||
            claim.queries.some((q) => typeof q !== "string" || !q.trim() || q.length > 200),
        )
      )
        throw new Error("Evidence Agent returned an invalid claim plan");
      input.claims = plan.map((claim, index) => ({ id: `claim-${index + 1}`, text: claim.text }));
      search ??= await openCoverageSearch(cwd);
      const paths = new Set(input.exactMatches.map((match) => match.path));
      const candidates: { path: string; snippet?: string; score?: number; claimId: string }[] = [];
      for (const [index, claim] of plan.entries()) {
        for (const scope of COVERAGE_SCOPES) {
          for (const query of claim.queries) {
            const receipt = {
              claimId: input.claims[index].id,
              queries: [query],
              scopes: [scope],
              mode: undefined as string | undefined,
              effectiveQueries: undefined as string[] | undefined,
              error: undefined as string | undefined,
            };
            input.queries.push(receipt);
            try {
              const result = await search.search(query, scope);
              receipt.mode = result.mode;
              if (result.effectiveQuery) receipt.effectiveQueries = [result.effectiveQuery];
              for (const hit of result.hits)
                candidates.push({ ...hit, claimId: input.claims[index].id });
            } catch (error) {
              receipt.error = String(error);
            }
          }
        }
      }
      if (input.queries.some((q) => q.error))
        throw new Error("Coverage search failed; see query receipts");
      if (candidates.length) {
        const selected = await (
          options.select ??
          (async (hits) => {
            const prompt = readFileSync(
              join(deps.config.promptsDir, "agents/coverage/USER_PROMPT_selection.md"),
              "utf8",
            );
            return parseEvidenceJson(
              (
                await deps.coverage.ask(
                  "coverage.select",
                  prompt,
                  JSON.stringify({ claims: input.claims, candidates: hits }),
                )
              ).text,
            ) as string[];
          })
        )(candidates);
        if (
          !Array.isArray(selected) ||
          selected.length > 6 ||
          selected.some(
            (path) =>
              typeof path !== "string" || !candidates.some((candidate) => candidate.path === path),
          )
        )
          throw new Error("Evidence Agent selected an unverified evidence path");
        for (const path of selected) paths.add(path);
      }
      input.evidence = readCoverageEvidence(cwd, [...paths]).map((evidence) => ({
        ...evidence,
        claimIds: [
          ...new Set(
            candidates
              .filter((candidate) => candidate.path === evidence.path)
              .map((candidate) => candidate.claimId),
          ),
        ],
      }));
    }
    if (input.evidence.reduce((sum, e) => sum + e.excerpt.length, 0) > 120000)
      throw new Error("Coverage evidence exceeds the reading budget; narrow the claims");
    if (
      !input.evidencePrepared &&
      input.evidence.reduce((sum, e) => sum + e.excerpt.length, 0) > EVIDENCE_CHARS
    ) {
      const prompt = readFileSync(
        join(deps.config.promptsDir, "agents/coverage/USER_PROMPT_excerpts.md"),
        "utf8",
      );
      const reply = await deps.coverage.ask(
        "coverage.excerpts",
        prompt,
        JSON.stringify({ claims: input.claims, documents: evidenceBlocks(input.evidence) }),
      );
      input.evidence = selectEvidenceExcerpts(input.evidence, parseEvidenceJson(reply.text));
      if (!input.evidence.length) throw new Error("No sufficient evidence context selected");
    }
    input.evidencePrepared = true;
    input.reason = "Evidence prepared";
    publish();
    if (!options.snapshot && coverageSnapshot(cwd) !== input.coverageSnapshot)
      throw new Error("Coverage changed during evidence preparation");
    const vars = {
      material,
      claims: input.claims,
      coverage: {
        evidence: input.evidence,
        queries: input.queries,
        exactMatches: input.exactMatches,
      },
      calibrationExamples: calibrationExamples(deps.store, item).slice(0, 6),
    };
    const ref = { itemId, sweepId: item.sweepId };
    const judge = async (name: "coverage" | "incremental", values: Record<string, unknown>) => {
      const callId = `assessment:${input.materialHash}:${input.coverageSnapshot}:${contentHash(JSON.stringify(values))}`;
      const previous = deps.store.db
        .prepare(
          "SELECT answers_json FROM jev_calls WHERE item_id=? AND command=? AND version=? AND call_id=? AND error IS NULL ORDER BY id DESC LIMIT 1",
        )
        .get(itemId, name, deps.judge.commands[name].version, callId) as
        | { answers_json: string }
        | undefined;
      return previous
        ? {
            answers: JSON.parse(previous.answers_json) as Awaited<
              ReturnType<typeof deps.judge.run>
            >["answers"],
          }
        : deps.judge.run(name, values, { ...ref, callId });
    };
    const coverage = await judge("coverage", vars);
    input.judgments = {};
    for (const [key, answer] of Object.entries(coverage.answers)) {
      const judgment = answer as ChoiceAnswer;
      input.judgments[key] = {
        choice: judgment.choice,
        confidence: judgment.confidence,
        probabilities: judgment.probabilities,
      };
    }
    const unknownClaims = Object.entries(input.judgments)
      .filter(([, judgment]) => judgment.choice === "unknown")
      .map(([key]) => input.claims[Number(key.split("_")[1])]?.id ?? key);
    if (unknownClaims.length > 0)
      throw new Error(`Coverage unknown for ${unknownClaims.join(", ")}`);
    const result = await judge("incremental", {
      ...vars,
      coverage: { ...vars.coverage, judgments: input.judgments },
    });
    if (!options.snapshot && coverageSnapshot(cwd) !== input.coverageSnapshot)
      throw new Error("Coverage changed while judging");
    const score = (key: string) => {
      const applies = (result.answers[`${key}_applies`] as NoulAnswer).noul;
      const novelty = result.answers[`${key}_novelty`] as ScoreAnswer;
      const value = result.answers[`${key}_value`] as ScoreAnswer;
      const incremental = result.answers[`${key}_incremental`] as ScoreAnswer;
      input.judgments![`${key}_applies`] = { probability: applies };
      for (const [name, answer] of [
        ["novelty", novelty],
        ["value", value],
        ["incremental", incremental],
      ] as const)
        input.judgments![`${key}_${name}`] = {
          confidence: answer.confidence,
          probabilities: answer.probabilities,
        };
      return Math.round(100 * normalized(incremental));
    };
    input.scores = {
      design: score("design"),
      tools: score("tools"),
      reference: score("reference"),
    };
    input.confidence = Math.min(
      ...Object.values(input.judgments).flatMap((j) =>
        j.confidence === undefined ? [] : [j.confidence],
      ),
    );
    input.jevCallId = (
      deps.store.db
        .prepare(
          "SELECT id FROM jev_calls WHERE item_id = ? AND command = 'incremental' ORDER BY id DESC LIMIT 1",
        )
        .get(itemId) as { id: number }
    ).id;
    input.reason =
      input.confidence < 0.5
        ? "判断概率分散，覆盖或价值判断仍不确定；可请求补充阅读后重新检查"
        : page
          ? "基于本次材料阅读和固定覆盖证据；概率分布见评估详情"
          : "仅读取摘要，尚未读取全文";
    input.status = "completed";
  } catch (error) {
    input.status = "unknown";
    input.reason = error instanceof Error ? error.message : String(error);
    delete input.scores;
  } finally {
    if (!options.search) search?.close();
  }
  return publish();
}
