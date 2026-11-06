import assert from "node:assert/strict";
import { test } from "node:test";
import { localDoctor } from "../src/local-doctor.ts";

test("local doctor distinguishes required and optional failures without leaking credentials or command errors", async () => {
  const secret = "fixture-secret-do-not-print";
  const calls: string[][] = [];
  const checks = await localDoctor({
    env: { TYPESAFE_API_KEY: secret, DNA_WIKI_DIR: "/missing-fixture" },
    enabledKinds: ["youtube_channel"],
    run: async (command, args) => {
      calls.push([command, ...args]);
      if (command === "yt-dlp") throw new Error(secret);
      return secret;
    },
    checkHub: async () => false,
  });
  assert.equal(checks.find((c) => c.name === "yt-dlp --version")?.required, true);
  assert.equal(checks.find((c) => c.name === "yt-dlp --version")?.ok, false);
  assert.equal(checks.find((c) => c.name === "Browser hub")?.required, false);
  assert.equal(checks.find((c) => c.name === "JEV configuration")?.ok, true);
  assert.ok(!JSON.stringify(checks).includes(secret));
  assert.ok(!calls.some((args) => args.includes("auth")));
});
