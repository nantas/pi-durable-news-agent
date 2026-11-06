// Boot the real dna-server-api as a child process on the faux model and fixture sources, in a temp data dir
//.
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DnaClient } from "@dna/sdk";
import { newToken } from "@dna/sdk/node";

export async function freePort(): Promise<number> {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>((r) => probe.close(() => r()));
  return port;
}

export interface Booted {
  base: string;
  dir: string;
  tokens: { client: string; cron: string };
  client: DnaClient;
  cron: DnaClient;
  anon: DnaClient;
  start(): Promise<void>;
  stop(signal?: NodeJS.Signals): Promise<void>;
  output(): string;
  cleanup(): Promise<void>;
}

export async function bootServer(env: Record<string, string> = {}): Promise<Booted> {
  const dir = mkdtempSync(join(tmpdir(), "dna-srv-"));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const tokens = { client: newToken(), cron: newToken() };
  let child: ChildProcess | undefined;
  let output = "";
  const start = async () => {
    child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        resolve(import.meta.dirname, "../src/main.ts"),
        "--port",
        String(port),
        "--host",
        "127.0.0.1",
      ],
      {
        env: {
          ...process.env,
          NODE_NO_WARNINGS: "1",
          DNA_ENV_FILE: "none",
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
          DNA_FIXTURE_SET: "news",
          DNA_DATA_DIR: dir,
          DNA_LOG_DIR: join(dir, "logs"),
          DNA_DEVICE_NAME: "test",
          DNA_CLIENT_TOKEN: tokens.client,
          DNA_CRON_TOKEN: tokens.cron,
          ...env,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    child.stdout?.on("data", (x) => (output += x));
    child.stderr?.on("data", (x) => (output += x));
    for (let i = 0; i < 300; i++) {
      try {
        if ((await fetch(`${base}/healthz`)).ok) return;
      } catch {}
      if (child.exitCode !== null) throw new Error(`Server exited: ${output}`);
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`Server did not start: ${output}`);
  };
  const stop = async (signal: NodeJS.Signals = "SIGTERM") => {
    if (child && child.exitCode === null) {
      const exited = once(child, "exit");
      child.kill(signal);
      await exited;
    }
  };
  try {
    await start();
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
  return {
    base,
    dir,
    tokens,
    client: new DnaClient(base, tokens.client),
    cron: new DnaClient(base, tokens.cron),
    anon: new DnaClient(base),
    start,
    stop,
    output: () => output,
    cleanup: async () => {
      await stop();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Poll a sweep until it settles. */
export async function settledSweep(client: DnaClient, id: number, ms = 30_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const sweep = await client.sweep(id);
    if (["completed", "no_news", "failed", "stalled"].includes(sweep.status)) return sweep;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Sweep ${id} did not settle`);
}

/** Poll until the agent is idle. */
export async function idle(client: DnaClient, ms = 30_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (!(await client.agent()).busy) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("Agent stayed busy");
}
