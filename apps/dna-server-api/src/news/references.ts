import type { Http } from "./http.ts";

export interface ReferenceResult {
  library: "artic" | "sakugabooru";
  ok: boolean;
  results: {
    title: string;
    url: string;
    creator?: string;
    date?: string;
    tags?: string;
    rights: string;
  }[];
  source: string;
  error?: string;
}
export async function searchReferences(
  http: Http,
  query: string,
  library: "artic" | "sakugabooru",
): Promise<ReferenceResult> {
  const source =
    library === "artic"
      ? "https://api.artic.edu/api/v1/artworks/search"
      : "https://www.sakugabooru.com/post.json";
  const url = new URL(source);
  url.searchParams.set("limit", "5");
  if (library === "artic") {
    url.searchParams.set("q", query);
    url.searchParams.set("fields", "id,title,artist_title,date_display,is_public_domain");
  } else url.searchParams.set("tags", `${query.replace(/rating:\S+/g, "").trim()} rating:s`);
  try {
    const response = await http.get(url.toString());
    const payload = JSON.parse(response.text);
    const rows: Record<string, unknown>[] = library === "artic" ? payload.data : payload;
    if (!Array.isArray(rows)) throw new Error("Invalid reference API response");
    const results = rows
      .filter((row) => Number.isSafeInteger(row.id) && Number(row.id) > 0)
      .map((row) =>
        library === "artic"
          ? {
              title: String(row.title ?? "Untitled"),
              url: `https://www.artic.edu/artworks/${row.id}`,
              creator: String(row.artist_title ?? ""),
              date: String(row.date_display ?? ""),
              rights:
                row.is_public_domain === true
                  ? "API 标记为公有领域；使用前核对原页许可"
                  : "版权状态需在原页核对；这里只返回元数据与链接",
            }
          : {
              title: `动画参考 ${row.id}`,
              url: `https://www.sakugabooru.com/post/show/${row.id}`,
              tags: String(row.tags ?? ""),
              rights: "作品权利归原权利人；按原页及原始来源许可使用，不镜像视频或图片",
            },
      );
    return { library, ok: true, source: url.toString(), results };
  } catch (error) {
    return {
      library,
      ok: false,
      source: url.toString(),
      results: [],
      error: `访问失败或受限：${String(error)}`,
    };
  }
}
