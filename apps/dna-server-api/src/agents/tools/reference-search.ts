import * as schema from "@earendil-works/pi-schema";
import { defineAppTool, toolText } from "@dna/durable-agent";
import type { Deps } from "../../deps.ts";
import { searchReferences } from "../../news/references.ts";

export function referenceSearch(deps: Deps) {
  return defineAppTool({
    name: "reference_search",
    description:
      "按需查找艺术品、题材、美学和动画镜头参考。artic 支持自然语言艺术查询；sakugabooru 使用英文下划线标签。只返回元数据、许可提示与原链接，不加入 Feed，不下载图像或视频。",
    returns:
      "JSON: reference metadata, original links, rights notices and per-library access errors.",
    parameters: schema.obj({
      query: schema.str({ minLength: 1, maxLength: 200 }),
      library: schema.union([schema.lit("artic"), schema.lit("sakugabooru"), schema.lit("both")]),
    }),
    replay: "safe",
    execute: async (args, api, ctx) => {
      const cached = await api.memo<string>("references", ctx);
      if (cached) return toolText(cached);
      const libraries =
        args.library === "both" ? (["artic", "sakugabooru"] as const) : [args.library];
      const text = JSON.stringify(
        await Promise.all(
          libraries.map((library) => searchReferences(deps.http, args.query, library)),
        ),
      );
      await api.memo("references", text, ctx);
      return toolText(text);
    },
  });
}
