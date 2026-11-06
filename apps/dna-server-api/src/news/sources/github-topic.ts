import type { Fetcher } from "./types.ts";

export function githubCategory(text: string): string | undefined {
  const categories = [
    ["engine", /godot|game engine|unity|unreal/i],
    ["game-ai", /npc|behaviou?r tree|game.{0,30}(ai|agent)/i],
    ["art-animation", /pixel art|sprite|texture|animation|blender|comfyui/i],
    ["audio", /audio|sound design|music production/i],
    ["level-systems", /level design|procedural generation|dungeon|game design/i],
    [
      "agent-workflow",
      /agent.{0,30}(workflow|coding)|workflow.{0,30}agent|game development|gamedev/i,
    ],
  ] as const;
  return categories.find(([, pattern]) => pattern.test(text))?.[0];
}
interface Repo {
  full_name: string;
  html_url: string;
  description?: string;
  topics?: string[];
  stargazers_count: number;
  pushed_at?: string;
  created_at?: string;
  archived?: boolean;
}
interface Point {
  day: string;
  stars: number;
}
export function starDeltas(history: Point[], now = new Date()) {
  const current = history.find((point) => point.day === now.toISOString().slice(0, 10));
  const delta = (days: number) => {
    const baseline = history.find(
      (point) => point.day === new Date(now.getTime() - days * 86400000).toISOString().slice(0, 10),
    );
    return current && baseline ? current.stars - baseline.stars : undefined;
  };
  return { stars7d: delta(7), stars30d: delta(30) };
}
export const fetchGithubTopics: Fetcher = async (source, ctx) => {
  if (!ctx.run || !ctx.store)
    throw new Error("GitHub discovery needs its command runner and cache");
  const run = ctx.run;
  const listing = JSON.parse(
    await run("gh", [
      "api",
      "--method",
      "GET",
      "search/repositories",
      "-f",
      `q=${source.query || "topic:game-development"} archived:false`,
      "-f",
      "sort=updated",
      "-f",
      "per_page=10",
    ]),
  ) as { items?: Repo[] };
  if (!Array.isArray(listing.items)) throw new Error("Invalid GitHub repository search response");
  const entries = [];
  const failures: string[] = [];
  for (const repo of listing.items) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo.full_name) || repo.archived) continue;
    const category = githubCategory([repo.description, ...(repo.topics ?? [])].join(" "));
    if (!category) continue;
    try {
      const previous = ctx.store.sources.cached(repo.html_url);
      if (previous?.metadata?.github && ctx.store.sources.isFresh(previous)) {
        entries.push({
          url: repo.html_url,
          title: repo.full_name,
          excerpt: previous.excerpt,
          metadata: previous.metadata,
        });
        continue;
      }
      const readme = await run("gh", [
        "api",
        `repos/${repo.full_name}/readme`,
        "-H",
        "Accept: application/vnd.github.raw+json",
      ]);
      const actualCategory = githubCategory(readme.slice(0, 16000));
      if (!actualCategory) continue;
      let release: { tag_name?: string; published_at?: string } | undefined;
      try {
        release = JSON.parse(await run("gh", ["api", `repos/${repo.full_name}/releases/latest`]));
      } catch (error) {
        if (!String(error).includes("404"))
          failures.push(`${repo.full_name}: release lookup failed`);
      }
      const now = new Date();
      const day = now.toISOString().slice(0, 10);
      const previousHistory =
        (previous?.metadata?.github as { history?: Point[] } | undefined)?.history ?? [];
      const history = [
        ...previousHistory.filter(
          (point) =>
            point.day !== day &&
            point.day >= new Date(now.getTime() - 35 * 86400000).toISOString().slice(0, 10),
        ),
        { day, stars: repo.stargazers_count },
      ];
      const metrics = {
        category: actualCategory,
        stars: repo.stargazers_count,
        ...starDeltas(history, now),
        createdAt: repo.created_at,
        pushedAt: repo.pushed_at,
        release,
        history,
        attribution: "GitHub official API; net growth requires saved daily baselines",
      };
      entries.push({
        url: repo.html_url,
        title: repo.full_name,
        excerpt: `${repo.description ?? ""}\n${JSON.stringify(metrics)}`,
        metadata: { github: metrics },
      });
    } catch (error) {
      failures.push(`${repo.full_name}: ${String(error).slice(0, 250)}`);
    }
  }
  entries.sort((a, b) => {
    const score = (entry: typeof a) => {
      const metrics = entry.metadata?.github as { stars7d?: number; stars?: number };
      return metrics?.stars7d ?? metrics?.stars ?? 0;
    };
    return score(b) - score(a);
  });
  return {
    ok: true,
    status: `${entries.length} game-creation repositories; ${failures.length} partial failures${failures.length ? `: ${failures.join("; ")}` : ""}`,
    entries,
  };
};
