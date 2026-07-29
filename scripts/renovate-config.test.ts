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
      matchDepNames: z.array(z.string()).optional(),
      matchManagers: z.array(z.string()).optional(),
      matchPackageNames: z.array(z.string()).optional(),
      groupName: z.string().optional(),
      enabled: z.boolean().optional(),
      minimumReleaseAge: z.union([z.string(), z.literal(false)]).optional(),
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

test("drives Playwright upgrades from the official image source only", async () => {
  const config = RenovateConfigSchema.parse(
    await Bun.file(`${root}/renovate.json`).json(),
  );
  const rule = config.packageRules.find(
    (candidate) =>
      candidate.description ===
      "Playwright client packages are promoted atomically with the tested ci-playwright image digest; Renovate owns only the official Dockerfile source pin.",
  );
  expect(rule).toEqual({
    description:
      "Playwright client packages are promoted atomically with the tested ci-playwright image digest; Renovate owns only the official Dockerfile source pin.",
    matchManagers: ["npm"],
    matchPackageNames: ["playwright", "@playwright/test"],
    enabled: false,
    minimumReleaseAge: false,
  });

  const dockerfile = await Bun.file(
    `${root}/.buildkite/ci-playwright/Dockerfile`,
  ).text();
  expect(dockerfile).toContain(
    "# renovate: datasource=docker depName=mcr.microsoft.com/playwright",
  );
  expect(dockerfile).toMatch(
    /^FROM mcr\.microsoft\.com\/playwright:v\d+\.\d+\.\d+-noble@sha256:[a-f0-9]{64}$/m,
  );
});

test("updates application Dockerfile tool pins without hardcoded test fixtures", async () => {
  const config = RenovateConfigSchema.parse(
    await Bun.file(`${root}/renovate.json`).json(),
  );
  const manager = config.customManagers.find(
    (candidate) =>
      candidate.description ===
      "Pinned tool versions in application Dockerfile ARGs",
  );
  if (manager === undefined) {
    throw new Error("Application Dockerfile ARG Renovate manager is missing");
  }
  const expression = manager.matchStrings[0];
  if (expression === undefined) {
    throw new Error("Application Dockerfile ARG Renovate matcher is missing");
  }
  const pinsByFile = await Promise.all(
    manager.managerFilePatterns.map(async (path) => {
      const source = await Bun.file(`${root}/${path}`).text();
      return [...source.matchAll(new RegExp(expression, "gm"))].map(
        (match) => ({
          depName: match.groups?.["depName"],
          currentValue: match.groups?.["currentValue"],
        }),
      );
    }),
  );
  const pins = pinsByFile.flat();
  expect(pins).toEqual([
    { depName: "yt-dlp/yt-dlp", currentValue: expect.stringMatching(/^\d/) },
    { depName: "uv", currentValue: expect.stringMatching(/^\d/) },
    { depName: "yt-dlp/yt-dlp", currentValue: expect.stringMatching(/^\d/) },
  ]);

  const ytDlpRule = config.packageRules.find(
    (candidate) =>
      candidate.description ===
      "Keep the yt-dlp binary pin synchronized across application images",
  );
  expect(ytDlpRule).toEqual({
    description:
      "Keep the yt-dlp binary pin synchronized across application images",
    groupName: "yt-dlp image binary",
    matchDepNames: ["yt-dlp/yt-dlp"],
    matchFileNames: [
      "packages/birmel/Dockerfile",
      "packages/streambot/Dockerfile",
    ],
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
