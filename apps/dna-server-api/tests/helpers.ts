import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, type Config } from "../src/config.ts";
import { openStore, type Store } from "../src/db/store.ts";
import { openApp, type App } from "../src/runtime.ts";

export const ROOT = join(import.meta.dirname, "../../..");
export const CONFIG_DIR = join(import.meta.dirname, "../config");
export const PROMPTS_DIR = join(import.meta.dirname, "../prompt_engineering");

export function tempStore(): { store: Store; dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "dna-api-"));
  const store = openStore(dir, CONFIG_DIR);
  return {
    store,
    dir,
    cleanup: () => {
      try {
        store.close();
      } catch {}
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export const until = async (
  check: () => boolean | Promise<boolean>,
  ms = 10_000,
  label = "condition",
) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`Timed out waiting for ${label}`);
};

/** A faux app on fixture feeds and fixture jev, in a temp dir. */
export async function fauxApp(
  env: Record<string, string> = {},
): Promise<{ app: App; dir: string; config: Config; cleanup: () => Promise<void> }> {
  const dir = mkdtempSync(join(tmpdir(), "dna-app-"));
  process.env.DNA_LOG_DIR = join(dir, "logs");
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  const config = loadConfig([], {
    ...process.env,
    DNA_WIKI_DIR: "",
    DNA_PROVIDER: "faux",
    JEV_BACKEND: "fixture",
    DNA_MODEL: "faux-haiku",
    DNA_RESEARCH_MODEL: "faux-haiku",
    DNA_QUICK_MODEL: "anthropic/claude-haiku-5.5",
    DNA_COVERAGE_MODEL: "faux-haiku",
    DNA_DEEP_RESEARCH_MODEL: "anthropic/claude-haiku-5.5",
    DNA_SUMMARY_MODEL: "faux-haiku",
    DNA_SEARCH_MODE: "fixture",
    DNA_DATA_DIR: dir,
    ...env,
  });
  const app = await openApp(config);
  return {
    app,
    dir,
    config,
    cleanup: async () => {
      try {
        await app.close();
      } catch {}
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export async function waitForSweep(app: App, sweepId: number, ms = 30_000) {
  await until(
    () =>
      ["completed", "no_news", "failed", "stalled"].includes(app.store.sweeps.get(sweepId)!.status),
    ms,
    `sweep ${sweepId}`,
  );
  await app.main.waitForIdle(app.ctx);
  await new Promise((r) => setTimeout(r, 1700));
  return app.store.sweeps.get(sweepId)!;
}
