import * as schema from "@earendil-works/pi-schema";
import { defineAppTool, toolText } from "@dna/durable-agent";
import type { Deps } from "../../deps.ts";
import { discoverX } from "../../news/x-discovery.ts";

export function xDiscover(deps: Deps) {
  return defineAppTool({
    name: "x_discover",
    description:
      "无 X 登录、Cookie 或 API key 的辅助发现：趋势话题、搜索引擎已索引帖子、已知公开帖子的 FxEmbed 正文回填。非实时、不完整、非核心定时来源。",
    returns:
      "JSON: limitations, trend provenance, indexed links, public post text and independent failure details.",
    parameters: schema.obj({
      query: schema.opt(schema.str({ minLength: 1, maxLength: 200 })),
      post_url: schema.opt(schema.str({ maxLength: 500 })),
    }),
    replay: "safe",
    execute: async (args, api, ctx) => {
      const cached = await api.memo<string>("x-discovery", ctx);
      if (cached) return toolText(cached);
      const text = JSON.stringify(await discoverX(deps, args.query, args.post_url));
      await api.memo("x-discovery", text, ctx);
      return toolText(text);
    },
  });
}
