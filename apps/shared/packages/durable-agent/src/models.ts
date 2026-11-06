// Production exposes only explicitly configured Pi models. The legacy catalog is an offline fixture.
import { createModels, type MutableModels } from "@earendil-works/pi-ai/models";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { Models } from "@earendil-works/pi-ai";
import type { ModelRef } from "@earendil-works/pi-durable";

export interface CatalogEntry {
  id: string;
  name: string;
  tier: string;
  icon: string;
}

export interface ModelInfo extends CatalogEntry {
  provider: string;
  contextWindow: number;
  reasoning: boolean;
  billingUnknown?: boolean;
  cost: { input: number; output: number };
}

export const DEFAULT_MODEL = "anthropic/claude-haiku-5.5";
export const FAUX_WINDOW = 1_000_000;
export const FAUX_MODEL = "faux-haiku";

export const CATALOG: readonly CatalogEntry[] = [
  { id: "anthropic/claude-haiku-5.5", name: "Claude Haiku 5.5", tier: "A", icon: "anthropic.png" },
  { id: "anthropic/claude-opus-5.5", name: "Claude Opus 5.5", tier: "S+", icon: "anthropic.png" },
  {
    id: "anthropic/claude-sonnet-5.5",
    name: "Claude Sonnet 5.5",
    tier: "S+",
    icon: "anthropic.png",
  },
  { id: "anthropic/claude-fable-5.1", name: "Claude Fable 5.1", tier: "S+", icon: "anthropic.png" },
  { id: "openai/gpt-6-astra", name: "GPT-6 Astra", tier: "S+", icon: "openai.png" },
  { id: "anthropic/claude-opus-5", name: "Opus 5", tier: "S+", icon: "anthropic.png" },
  { id: "openai/gpt-6.1-sol", name: "GPT-6.1 Sol", tier: "S+", icon: "openai.png" },
  { id: "anthropic/claude-fable-5", name: "Fable 5", tier: "S", icon: "anthropic.png" },
  { id: "meta/muse-spark-1.3", name: "Muse Spark 1.3", tier: "S", icon: "meta.png" },
  { id: "openai/gpt-6-sol", name: "GPT-6 Sol", tier: "S", icon: "openai.png" },
  { id: "x-ai/grok-4.7", name: "Grok 4.7", tier: "S", icon: "grok.png" },
  { id: "xiaomi/mimo-v2.6-pro", name: "MiMo-V2.6-Pro", tier: "S", icon: "xiaomi.png" },
  { id: "x-ai/grok-4.6", name: "Grok 4.6", tier: "S", icon: "grok.png" },
  { id: "z-ai/glm-5.3", name: "GLM-5.3", tier: "A", icon: "zai.png" },
  { id: "moonshotai/kimi-k3", name: "Kimi K3", tier: "A", icon: "kimi.png" },
  { id: "openai/gpt-5.6-terra", name: "GPT 5.6 Terra", tier: "A", icon: "openai.png" },
  { id: "google/gemini-3.8-flash", name: "Gemini 3.8 Flash", tier: "A", icon: "gemini.png" },
  { id: "qwen/qwen3.8-2.4t-a95b", name: "Qwen3.8-2.4T-A95B", tier: "A", icon: "qwen.png" },
  {
    id: "deepseek/deepseek-v4.1-flash",
    name: "DeepSeek V4.1 Flash",
    tier: "A",
    icon: "deepseek.png",
  },
  { id: "google/gemini-3.7-flash", name: "Gemini 3.7 Flash", tier: "A", icon: "gemini.png" },
  { id: "anthropic/claude-sonnet-5", name: "Sonnet 5", tier: "A", icon: "anthropic.png" },
  { id: "openai/gpt-6-luna", name: "GPT-6 Luna", tier: "A", icon: "openai.png" },
  { id: "xiaomi/mimo-v2.6-flash", name: "MiMo-V2.6-Flash", tier: "A", icon: "xiaomi.png" },
  { id: "openai/gpt-5.6-luna", name: "GPT 5.6 Luna", tier: "A", icon: "openai.png" },
  {
    id: "deepseek/deepseek-v4-pro-0813",
    name: "DeepSeek V4 Pro 0813",
    tier: "A",
    icon: "deepseek.png",
  },
  { id: "z-ai/glm-5.2", name: "GLM-5.2", tier: "A", icon: "zai.png" },
  { id: "z-ai/glm-5.3-flash", name: "GLM-5.3-Flash", tier: "B", icon: "zai.png" },
  { id: "google/gemini-3.1-pro-preview", name: "Gemini 3.1 Pro", tier: "B", icon: "gemini.png" },
  { id: "minimax/minimax-m3", name: "MiniMax-M3", tier: "B", icon: "minimax.png" },
  {
    id: "google/gemini-3.5-flash-lite",
    name: "Gemini 3.5 Flash-Lite",
    tier: "B",
    icon: "gemini.png",
  },
];

export interface ModelCatalog {
  readonly models: Models;
  readonly provider: "pi" | "faux";
  readonly defaultModel: ModelRef;
  list(): ModelInfo[];
  /** A catalog id to a pi-durable model reference; throws for ids outside the catalog. */
  ref(id: string): ModelRef;
  info(id: string): ModelInfo | undefined;
}

export function createModelCatalog(options: {
  provider: "pi" | "faux";
  installFaux?: (models: MutableModels) => void;
  defaultModel?: string;
  runtime?: Models;
  modelIds?: string[];
}): ModelCatalog {
  const models = createModels();
  if (options.provider === "faux") {
    if (!options.installFaux) throw new Error("A faux catalog needs installFaux");
    options.installFaux(models);
    const free = {
      provider: "faux",
      contextWindow: FAUX_WINDOW,
      reasoning: false,
      cost: { input: 0, output: 0 },
    };
    const all: ModelInfo[] = [
      { id: FAUX_MODEL, name: "Faux Haiku", tier: "T", icon: "lab.png", ...free },
      ...CATALOG.map((c) => ({ ...c, ...free })),
    ];
    return {
      models,
      provider: "faux",
      defaultModel: { provider: "faux", modelId: FAUX_MODEL },
      list: () => all,
      ref: (id) => {
        if (!all.some((m) => m.id === id))
          throw new Error(
            `Unknown model ${id}. The faux catalog mirrors the ${CATALOG.length} catalog models plus ${FAUX_MODEL}.`,
          );
        return { provider: "faux", modelId: id };
      },
      info: (id) => all.find((m) => m.id === id),
    };
  }
  const runtime = options.runtime;
  if (!runtime || !options.defaultModel || !options.modelIds?.length)
    throw new Error("Pi runtime and explicit role models are required");
  const ref = (id: string): ModelRef => {
    const slash = id.indexOf("/");
    if (slash < 1 || !options.modelIds!.includes(id))
      throw new Error(`Unknown model ${id}; configure an explicit provider/modelId`);
    const provider = id.slice(0, slash);
    const modelId = id.slice(slash + 1);
    if (!runtime.getModel(provider, modelId)) throw new Error(`Pi model ${id} is not registered`);
    return { provider, modelId };
  };
  const list = (): ModelInfo[] =>
    [...new Set(options.modelIds)].map((id) => {
      const selected = ref(id);
      const model = runtime.getModel(selected.provider, selected.modelId)!;
      return {
        id,
        name: model.name,
        tier: "",
        icon: "",
        provider: selected.provider,
        contextWindow: model.contextWindow,
        reasoning: model.reasoning,
        // SDK catalog prices do not establish actual billing, including API-key subscriptions.
        billingUnknown: runtime instanceof ModelRuntime,
        cost: { input: model.cost.input, output: model.cost.output },
      };
    });
  return {
    models: runtime,
    provider: "pi",
    defaultModel: ref(options.defaultModel),
    ref,
    list,
    info: (id) => list().find((model) => model.id === id),
  };
}

export async function openPiModelCatalog(
  defaultModel: string,
  modelIds: string[],
): Promise<ModelCatalog> {
  const runtime = await ModelRuntime.create({ allowModelNetwork: false });
  const catalog = createModelCatalog({ provider: "pi", defaultModel, modelIds, runtime });
  for (const id of modelIds) {
    const ref = catalog.ref(id);
    if (!runtime.hasConfiguredAuth(ref.provider))
      throw new Error(`Pi login is required for ${ref.provider}`);
  }
  return catalog;
}
