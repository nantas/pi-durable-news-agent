import { existsSync } from "node:fs";
import { join } from "node:path";
import { runCommand, type RunCommand } from "../../dna-server-api/src/news/commands.ts";
import type { Check } from "./net/probe.ts";

export async function localDoctor(
  options: {
    env?: Record<string, string | undefined>;
    run?: RunCommand;
    live?: boolean;
    enabledKinds?: string[];
    loadWiki?: (cwd: string) => Promise<void>;
    checkModels?: (ids: string[]) => Promise<boolean>;
    checkHub?: (port: number) => Promise<boolean>;
  } = {},
): Promise<Check[]> {
  const env = options.env ?? process.env;
  const run = options.run ?? runCommand;
  const checks: Check[] = [];
  const tool = async (command: string, args: string[], required: boolean) => {
    try {
      await run(command, args);
      checks.push({
        name: `${command} ${args.join(" ")}`,
        required,
        ok: true,
        detail: "available",
      });
    } catch {
      checks.push({
        name: `${command} ${args.join(" ")}`,
        required,
        ok: false,
        detail: "unavailable; check installation or authentication",
      });
    }
  };
  await Promise.all([
    tool("npm", ["--version"], true),
    tool("just", ["--version"], true),
    tool("git", ["--version"], true),
    tool("gh", ["--version"], options.enabledKinds?.includes("github_topic") ?? false),
    tool("yt-dlp", ["--version"], options.enabledKinds?.includes("youtube_channel") ?? false),
  ]);
  try {
    import.meta.resolve("@earendil-works/pi-coding-agent");
    checks.push({ name: "Pi SDK", required: true, ok: true, detail: "installed" });
  } catch {
    checks.push({
      name: "Pi SDK",
      required: true,
      ok: false,
      detail: "install workspace dependencies",
    });
  }
  const cwd = env.DNA_WIKI_DIR;
  const wikiExists =
    !!cwd &&
    existsSync(join(cwd, ".git")) &&
    existsSync(join(cwd, ".pi/extensions/obsidian-tools/index.ts"));
  checks.push({
    name: "my-wiki configuration",
    required: true,
    ok: wikiExists,
    detail: wikiExists
      ? "local checkout and extension present"
      : "set DNA_WIKI_DIR in the ignored local .env",
  });
  if (options.live && wikiExists) {
    try {
      const load =
        options.loadWiki ??
        (async (path: string) => {
          const { openCoverageSearch } = await import("../../dna-server-api/src/news/coverage.ts");
          const search = await openCoverageSearch(path);
          search.close();
        });
      await load(cwd!);
      checks.push({
        name: "obsidian_search loading",
        required: true,
        ok: true,
        detail: "read-only SDK tool loaded",
      });
    } catch {
      checks.push({
        name: "obsidian_search loading",
        required: true,
        ok: false,
        detail: "extension load failed",
      });
    }
  }
  if (options.live && options.enabledKinds?.includes("github_topic"))
    await tool("gh", ["auth", "status", "--active"], true);
  const roles = [
    "DNA_MODEL",
    "DNA_RESEARCH_MODEL",
    "DNA_QUICK_MODEL",
    "DNA_COVERAGE_MODEL",
    "DNA_DEEP_RESEARCH_MODEL",
    "DNA_SUMMARY_MODEL",
  ];
  const ids = roles.map((role) => env[role]?.trim() ?? "");
  checks.push({
    name: "Explicit model roles",
    required: true,
    ok: ids.every(Boolean),
    detail: ids.every(Boolean)
      ? "all roles configured"
      : `configure ${roles.filter((_, i) => !ids[i]).join(", ")} locally`,
  });
  if (options.live && ids.every(Boolean)) {
    let ok = false;
    try {
      ok = await (
        options.checkModels ??
        (async (selected) => {
          const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
          const runtime = await ModelRuntime.create({ allowModelNetwork: false });
          return selected.every((id) => {
            const slash = id.indexOf("/");
            const provider = id.slice(0, slash);
            return (
              slash > 0 &&
              !!runtime.getModel(provider, id.slice(slash + 1)) &&
              runtime.hasConfiguredAuth(provider)
            );
          });
        })
      )(ids);
    } catch {}
    checks.push({
      name: "Pi login model access",
      required: true,
      ok,
      detail: ok
        ? "registered models with configured Pi credentials; no generation requested"
        : "check explicit model IDs and Pi login; no credentials displayed",
    });
  }
  const jevConfigured = !!env.TYPESAFE_API_KEY?.trim();
  checks.push({
    name: "JEV configuration",
    required: true,
    ok: jevConfigured,
    detail: jevConfigured
      ? "official credentials configured; generation not checked"
      : "configure TYPESAFE_API_KEY locally",
  });
  const hubPort = Number(env.DNA_HUB_PORT ?? 4851);
  let hub = false;
  try {
    hub = await (
      options.checkHub ??
      (async (port: number) => {
        const res = await fetch(`http://127.0.0.1:${port}/hub/healthz`, {
          signal: AbortSignal.timeout(1500),
        });
        await res.body?.cancel();
        return res.ok;
      })
    )(hubPort);
  } catch {}
  checks.push({
    name: "Browser hub",
    required: false,
    ok: hub,
    detail: hub ? "running" : "not running; start with just browser dev",
  });
  return checks;
}
