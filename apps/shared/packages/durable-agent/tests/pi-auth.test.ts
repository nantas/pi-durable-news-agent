import assert from "node:assert/strict";
import { test } from "node:test";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { createFauxCore } from "@earendil-works/pi-ai/providers/faux";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { createModelCatalog } from "../src/models.ts";

test("Pi API-key and OAuth requests keep credentials in the SDK across concurrent refresh and restart", async () => {
  const credentials = new InMemoryCredentialStore();
  await credentials.modify("fixture-key", async () => ({
    type: "api_key",
    key: "fixture-api-secret",
  }));
  await credentials.modify("fixture-oauth", async () => ({
    type: "oauth",
    access: "expired",
    refresh: "fixture-refresh-secret",
    expires: 1,
  }));
  let refreshes = 0;
  const received: string[] = [];
  const open = async () => {
    const runtime = await ModelRuntime.create({
      credentials,
      modelsPath: null,
      allowModelNetwork: false,
      refreshOnCreate: false,
    });
    for (const provider of ["fixture-key", "fixture-oauth"]) {
      const faux = createFauxCore({
        provider,
        models: [{ id: "model", name: "Fixture", contextWindow: 8192, maxTokens: 1024 }],
      });
      runtime.registerProvider(provider, {
        api: "openai-completions",
        baseUrl: "https://fixture.invalid",
        models: [
          {
            id: "model",
            name: "Fixture",
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 8192,
            maxTokens: 1024,
          },
        ],
        streamSimple: (model, context, options) => {
          assert.equal(
            options?.apiKey,
            provider === "fixture-key" ? "fixture-api-secret" : "fixture-access-secret",
          );
          received.push(provider);
          return faux.streamSimple(model, context, options);
        },
        ...(provider === "fixture-oauth"
          ? {
              oauth: {
                name: "Fixture OAuth",
                isSubscription: true,
                login: async () => {
                  throw new Error("Login must not run");
                },
                refreshToken: async (credential) => {
                  refreshes++;
                  return {
                    ...credential,
                    access: "fixture-access-secret",
                    expires: Date.now() + 3_600_000,
                  };
                },
                getApiKey: (credential) => credential.access,
              },
            }
          : {}),
      });
    }
    await runtime.refresh({ allowNetwork: false });
    return createModelCatalog({
      provider: "pi",
      runtime,
      defaultModel: "fixture-key/model",
      modelIds: ["fixture-key/model", "fixture-oauth/model"],
    });
  };
  const ask = async (catalog: Awaited<ReturnType<typeof open>>, id: string) => {
    const ref = catalog.ref(id);
    const result = await catalog.models.completeSimple(
      catalog.models.getModel(ref.provider, ref.modelId)!,
      { messages: [{ role: "user", content: "hello", timestamp: 1 }] },
    );
    assert.ok(!JSON.stringify(result).includes("secret"));
  };
  let catalog = await open();
  await Promise.all([
    ask(catalog, "fixture-key/model"),
    ask(catalog, "fixture-oauth/model"),
    ask(catalog, "fixture-oauth/model"),
  ]);
  assert.equal(refreshes, 1);
  assert.equal(catalog.info("fixture-oauth/model")?.billingUnknown, true);
  assert.equal(catalog.info("fixture-key/model")?.billingUnknown, true);
  assert.ok(!JSON.stringify(catalog.list()).includes("secret"));
  catalog = await open();
  await ask(catalog, "fixture-oauth/model");
  assert.equal(refreshes, 1);
  assert.equal(received.length, 4);
});
