// dna doctor: Node 24, keys present (names only), the API, the scope matrix, the crontab line, search mode and credits.
import type { DnaClient } from "@dna/sdk";
import { managedLine, readCrontab } from "../../dna-server-cron/src/crontab.ts";
import { probe, type Check } from "./net/probe.ts";
import { localDoctor } from "./local-doctor.ts";
import { searchEngines } from "./print.ts";

const KEYS = ["FIRECRAWL_API_KEY", "DNA_CLIENT_TOKEN", "DNA_CRON_TOKEN"];
const OPTIONAL: Record<string, string> = {
  FIRECRAWL_API_KEY: "missing, search and page reads use the free engines",
};

export async function doctor(
  client: DnaClient,
  tokens: { client?: string; cron?: string },
  options: { live?: boolean } = {},
): Promise<Check[]> {
  const checks: Check[] = [];
  const major = Number(process.versions.node.split(".")[0]);
  checks.push({ name: "Node 24", ok: major >= 24, detail: process.versions.node });
  for (const key of KEYS) {
    const present = !!process.env[key]?.trim();
    checks.push({
      name: `${key} is set`,
      ok: present,
      required: !(key in OPTIONAL),
      detail: present ? "present" : (OPTIONAL[key] ?? "missing"),
    });
  }
  const sources = await client.sources().catch(() => []);
  checks.push(
    ...(await localDoctor({
      live: options.live,
      enabledKinds: sources.filter((source) => source.enabled).map((source) => source.kind),
    })),
  );
  checks.push(...(await probe(client.baseUrl, tokens)));
  let cronLine: string | undefined;
  try {
    cronLine = managedLine(readCrontab());
  } catch {}
  checks.push({
    name: "crontab line on this machine",
    ok: true,
    detail: cronLine ?? "none: this Mac sweeps on `just cron tick` (always on: just combos local)",
  });
  try {
    const info = await client.info();
    checks.push({ name: "search mode", ok: true, detail: info.searchMode });
    const engines = info.search?.engines ?? [];
    if (engines.length) {
      const resting = (name: string) => {
        const until = engines.find((e) => e.name === name)?.coolingUntil;
        return !!until && Date.parse(until) > Date.now();
      };
      checks.push({
        name: "search engines",
        // News search works while one news engine is not resting (Firecrawl counts in firecrawl mode).
        ok:
          !resting("bing-news") ||
          !resting("google-news") ||
          (info.searchMode === "firecrawl" && !resting("firecrawl")),
        detail: searchEngines(engines),
      });
    }
    if (info.searchMode === "firecrawl")
      checks.push({
        name: "Firecrawl credits",
        ok: (info.firecrawl?.creditsLeft ?? 1) > 0,
        detail: `${info.firecrawl?.creditsLeft ?? "unknown"} left, ${info.firecrawl?.creditsToday ?? 0} of ${info.firecrawl?.dailyCap} used today`,
      });
  } catch (error) {
    checks.push({ name: "API info", ok: false, detail: String((error as Error).message) });
  }
  return checks;
}
