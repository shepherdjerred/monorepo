import { expect, test } from "bun:test";
import { z } from "zod";

const RegexManagerSchema = z.object({
  description: z.string(),
  managerFilePatterns: z.array(z.string()),
  matchStrings: z.array(z.string()),
  depNameTemplate: z.string().optional(),
});

const RenovateConfigSchema = z.object({
  customManagers: z.array(RegexManagerSchema),
  packageRules: z.array(
    z.object({
      description: z.string().optional(),
      matchFileNames: z.array(z.string()).optional(),
      enabled: z.boolean().optional(),
    }),
  ),
  ignorePaths: z.array(z.string()),
});

const root = `${import.meta.dir}/..`;

test("excludes all sandbox dependency files", async () => {
  const config = RenovateConfigSchema.parse(
    await Bun.file(`${root}/renovate.json`).json(),
  );
  const sandboxRule = config.packageRules.find(
    (rule) =>
      rule.description ===
      "Sandbox is personal scratch space outside maintained dependency automation",
  );

  expect(config.ignorePaths).toEqual(["sandbox/**"]);
  expect(sandboxRule).toEqual({
    description:
      "Sandbox is personal scratch space outside maintained dependency automation",
    matchFileNames: ["sandbox/**"],
    enabled: false,
  });
});

test("extracts identical Emscripten tag and digest pins from both sources", async () => {
  const config = RenovateConfigSchema.parse(
    await Bun.file(`${root}/renovate.json`).json(),
  );
  const manager = config.customManagers.find(
    (candidate) => candidate.depNameTemplate === "emscripten/emsdk",
  );
  if (manager === undefined) {
    throw new Error("Emscripten Renovate manager is missing");
  }

  const sources = [
    await Bun.file(
      `${root}/packages/discord-plays-mario-kart/wasm-src/upstream.json`,
    ).text(),
    await Bun.file(
      `${root}/packages/discord-plays-mario-kart/Dockerfile`,
    ).text(),
  ];
  expect(manager.matchStrings).toHaveLength(2);
  expect(manager.matchStrings[0]).toContain("emsdkImage");
  expect(manager.matchStrings[1]).toContain("wasm-builder");

  const expressions = [
    /"emsdkImage":\s*"emscripten\/emsdk:(?<currentValue>[^@"]+)@(?<currentDigest>sha256:[a-f0-9]{64})"/,
    /FROM\s+emscripten\/emsdk:(?<currentValue>[^@\s]+)@(?<currentDigest>sha256:[a-f0-9]{64})\s+AS\s+wasm-builder/,
  ];
  const pins = expressions.flatMap((expression, index) => {
    const source = sources[index];
    if (source === undefined) {
      throw new Error(
        `Missing Emscripten source for expression ${index.toString()}`,
      );
    }
    const match = expression.exec(source);
    const currentValue = match?.groups?.["currentValue"];
    const currentDigest = match?.groups?.["currentDigest"];
    if (currentValue === undefined || currentDigest === undefined) {
      throw new Error(
        `Emscripten expression ${index.toString()} did not extract a complete pin`,
      );
    }
    return [`${currentValue}@${currentDigest}`];
  });

  expect(manager.managerFilePatterns).toEqual([
    "packages/discord-plays-mario-kart/wasm-src/upstream.json",
    "packages/discord-plays-mario-kart/Dockerfile",
  ]);
  expect(pins).toEqual([
    "6.0.4@sha256:3a0d11e50f072dc2c4bc92e3b05ab1340fb7d4dd152f80b8af35fc1c6f15e644",
    "6.0.4@sha256:3a0d11e50f072dc2c4bc92e3b05ab1340fb7d4dd152f80b8af35fc1c6f15e644",
  ]);
});
