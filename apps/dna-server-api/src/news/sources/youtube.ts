import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunCommand } from "../commands.ts";
import { parseFeed } from "./rss.ts";
import type { FeedEntry, Fetcher } from "./types.ts";

interface Video {
  id?: string;
  title?: string;
  timestamp?: number;
  availability?: string;
  description?: string;
}
export const fetchYoutube: Fetcher = async (source, ctx) => {
  const id = new URL(source.url).pathname.match(/^\/channel\/(UC[\w-]+)\/?$/)?.[1];
  if (!id) throw new Error("YouTube source needs a confirmed /channel/UC... URL");
  let entries: FeedEntry[] = [];
  const blocked = new Set<string>();
  let listingError: unknown;
  try {
    if (!ctx.run) throw new Error("YouTube command runner is not configured");
    const result = JSON.parse(
      await ctx.run("yt-dlp", [
        "--flat-playlist",
        "--dump-single-json",
        "--playlist-end",
        "20",
        "--skip-download",
        "--no-warnings",
        `https://www.youtube.com/channel/${id}/videos`,
      ]),
    ) as { entries?: Video[] };
    if (!Array.isArray(result.entries)) throw new Error("Invalid YouTube listing response");
    for (const video of result.entries)
      if (video.id && video.availability && !["public", "unlisted"].includes(video.availability))
        blocked.add(`https://www.youtube.com/watch?v=${video.id}`);
    entries = result.entries
      .filter(
        (video) =>
          video.id &&
          /^[\w-]{11}$/.test(video.id) &&
          video.title &&
          (!video.availability || ["public", "unlisted"].includes(video.availability)) &&
          !["[Private video]", "[Deleted video]"].includes(video.title),
      )
      .map((video) => ({
        url: `https://www.youtube.com/watch?v=${video.id}`,
        title: video.title!,
        excerpt: video.description,
        publishedAt: video.timestamp ? new Date(video.timestamp * 1000).toISOString() : undefined,
      }));
  } catch (error) {
    listingError = error;
  }
  try {
    const feed = await ctx.http.get(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`);
    const seen = new Set(entries.map((entry) => entry.url));
    entries.push(
      ...parseFeed(feed.text, source.url).filter(
        (entry) => !seen.has(entry.url) && !blocked.has(entry.url),
      ),
    );
  } catch (error) {
    if (listingError)
      throw new Error(
        `YouTube listing and RSS temporarily unavailable: ${String(listingError)}; ${String(error)}`,
      );
    ctx.log?.warn("youtube.rss_temporary_failure", { sourceId: source.id, error: String(error) });
  }
  return { ok: true, status: `youtube ${entries.length} public videos`, entries };
};

export function captionText(vtt: string): string {
  const lines = vtt
    .split(/\r?\n/)
    .map((line) => line.replace(/<[^>]*>/g, "").trim())
    .filter((line) => line && !/^WEBVTT|^Kind:|^Language:|^\d+$|-->/i.test(line));
  return lines.filter((line, index) => line !== lines[index - 1]).join("\n");
}
export async function readYoutubeCaptions(
  url: string,
  run: RunCommand,
): Promise<string | undefined> {
  const dir = mkdtempSync(join(tmpdir(), "dna-captions-"));
  try {
    await run("yt-dlp", [
      "--skip-download",
      "--write-subs",
      "--write-auto-subs",
      "--sub-langs",
      "en,zh-Hans,zh",
      "--sub-format",
      "vtt",
      "--no-playlist",
      "--output",
      join(dir, "%(id)s"),
      url,
    ]);
    const file = readdirSync(dir)
      .filter((file) => file.endsWith(".vtt"))
      .sort()[0];
    return file ? captionText(readFileSync(join(dir, file), "utf8")) : undefined;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
