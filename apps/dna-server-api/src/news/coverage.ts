import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { Assessment } from "@dna/sdk";
import { canonicalUrl } from "../db/repos/sources.ts";

export const COVERAGE_SCOPES = ["10-wiki", "20-synthesis", "30-raw"] as const;
export const contentHash = (text: string | Buffer) =>
  createHash("sha256").update(text).digest("hex");

export function coverageFiles(cwd: string): string[] {
  return execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...COVERAGE_SCOPES],
    { cwd, maxBuffer: 32 * 1024 * 1024 },
  )
    .toString()
    .split("\0")
    .filter((path) => !!path && existsSync(join(cwd, path)))
    .sort();
}

function readCovered(cwd: string, path: string): Buffer {
  const root = realpathSync(cwd);
  const file = realpathSync(resolve(root, path));
  const local = relative(root, file);
  if (
    local.startsWith(`..${sep}`) ||
    !COVERAGE_SCOPES.some((scope) => local.startsWith(`${scope}${sep}`))
  )
    throw new Error("Evidence path is outside coverage directories");
  return readFileSync(file);
}

export function coverageSnapshot(cwd: string): string {
  const hash = createHash("sha256");
  hash.update(execFileSync("git", ["rev-parse", "HEAD"], { cwd }));
  for (const path of coverageFiles(cwd)) {
    hash.update(path);
    hash.update("\0");
    hash.update(readCovered(cwd, path));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function lookupMaterial(cwd: string, url: string): { path: string; layer: string }[] {
  const canonical = canonicalUrl(url);
  return coverageFiles(cwd).flatMap((path) => {
    const urls =
      readCovered(cwd, path)
        .toString()
        .match(/https?:\/\/[^\s<>"'\])]+/g) ?? [];
    return urls.some((value) => canonicalUrl(value) === canonical)
      ? [{ path, layer: coverageLayer(path) }]
      : [];
  });
}

export function coverageLayer(path: string): string {
  return path.startsWith("20-synthesis/source-bookmark/") ? "bookmark" : path.split("/")[0];
}

export function readCoverageEvidence(cwd: string, paths: string[]): Assessment["evidence"] {
  return [...new Set(paths)].map((path) => {
    const bytes = readCovered(cwd, path);
    return {
      id: contentHash(path).slice(0, 16),
      path,
      layer: coverageLayer(path),
      excerpt: bytes.toString(),
      contentHash: contentHash(bytes),
    };
  });
}

export interface CoverageSearchResult {
  hits: { path: string; snippet?: string; score?: number }[];
  mode: string;
  effectiveQuery?: string;
}
export interface CoverageSearch {
  search(query: string, scope: string): Promise<CoverageSearchResult>;
  close(): void;
}

export async function openCoverageSearch(cwd: string): Promise<CoverageSearch> {
  const agentDir = join(homedir(), ".pi", "agent");
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    noExtensions: true,
    additionalExtensionPaths: [join(cwd, ".pi/extensions/obsidian-tools/index.ts")],
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    disabledBuiltinExtensions: ["mcp"],
  });
  await loader.reload();
  const { session } = await createAgentSession({
    cwd,
    agentDir,
    resourceLoader: loader,
    tools: ["obsidian_search"],
    sessionManager: SessionManager.inMemory(cwd),
  });
  const tool = session.agent.state.tools.find((tool) => tool.name === "obsidian_search");
  if (!tool) {
    session.dispose();
    throw new Error("my-wiki obsidian_search did not load");
  }
  return {
    async search(query, scope) {
      const result = await tool.execute(
        crypto.randomUUID(),
        { query, scope, vault: cwd, limit: 5 },
        AbortSignal.timeout(30_000),
      );
      const details = result.details as {
        ok?: boolean;
        error?: string;
        mode?: string;
        effective_query?: string;
        topk?: { path: string; snippet?: string; score?: number }[];
      };
      if (details?.ok !== true || !Array.isArray(details.topk))
        throw new Error(details?.error ?? "Coverage search failed or returned an invalid receipt");
      return {
        hits: details.topk,
        mode: details.mode ?? "unknown",
        effectiveQuery: details.effective_query,
      };
    },
    close: () => session.dispose(),
  };
}
