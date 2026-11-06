// A server stand-in for crash tests: open the faux app on <dir>, then either start a sweep and run until killed,
// or resume whatever was in flight, wait for sweep 1 to settle, print a summary and exit.
//   sweep-host.ts <dir> start
//   sweep-host.ts <dir> resume
import { loadConfig } from "../../src/config.ts";
import { startNewsSweep } from "../../src/news/sweep.ts";
import { openApp } from "../../src/runtime.ts";
import { waitForSweep } from "../helpers.ts";

const [dir, mode] = process.argv.slice(2);
process.env.DNA_LOG_DIR = `${dir}/logs`;
const config = loadConfig([], {
  ...process.env,
  DNA_PROVIDER: "faux",
  DNA_WIKI_DIR: "",
  JEV_BACKEND: "fixture",
  DNA_MODEL: "faux-haiku",
  DNA_RESEARCH_MODEL: "faux-haiku",
  DNA_QUICK_MODEL: "anthropic/claude-haiku-5.5",
  DNA_COVERAGE_MODEL: "faux-haiku",
  DNA_DEEP_RESEARCH_MODEL: "anthropic/claude-haiku-5.5",
  DNA_SUMMARY_MODEL: "faux-haiku",
  DNA_SEARCH_MODE: "fixture",
  DNA_DATA_DIR: dir,
});
const app = await openApp(config);

if (mode === "start") {
  await startNewsSweep(app, app.main, app.ctx, { trigger: "test", requestId: "crash:1" });
  await new Promise(() => {});
}
const sweep = await waitForSweep(app, 1, 60_000);
const cards = app.store.news.cards();
console.log(
  JSON.stringify({
    status: sweep.status,
    audit: sweep.audit,
    cards: cards.map((c) => ({
      kind: c.kind,
      itemId: c.itemId,
      title: c.title,
      timeline: c.timeline,
    })),
  }),
);
await app.close();
