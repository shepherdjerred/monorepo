import { expect, test } from "vitest";
import { z } from "zod";
import { parseVersionCatalog } from "@shepherdjerred/version-catalog";

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
      matchDatasources: z.array(z.string()).optional(),
      matchFileNames: z.array(z.string()).optional(),
      matchDepNames: z.array(z.string()).optional(),
      matchManagers: z.array(z.string()).optional(),
      matchNewValue: z.string().optional(),
      matchPackageNames: z.array(z.string()).optional(),
      allowedVersions: z.string().optional(),
      groupName: z.string().optional(),
      enabled: z.boolean().optional(),
      minimumReleaseAge: z.string().nullable().optional(),
    }),
  ),
  ignorePaths: z.array(z.string()),
});

const root = `${import.meta.dir}/..`;

test("extracts every managed structured version-catalog field", async () => {
  const config = RenovateConfigSchema.parse(
    await Bun.file(`${root}/renovate.json`).json(),
  );
  const manager = config.customManagers.find((candidate) =>
    candidate.managerFilePatterns.includes(
      "packages/version-catalog/src/catalog.json",
    ),
  );
  if (manager === undefined) {
    throw new Error("Structured version-catalog Renovate manager is missing");
  }
  const expression = manager.matchStrings[0];
  if (expression === undefined) {
    throw new Error("Structured version-catalog matcher is missing");
  }
  const catalogPath = `${root}/packages/version-catalog/src/catalog.json`;
  const source = await Bun.file(catalogPath).text();
  const catalog = parseVersionCatalog(JSON.parse(source));
  const actual = [...source.matchAll(new RegExp(expression, "g"))].map(
    (match) => ({
      depName: match.groups?.["depName"],
      datasource: match.groups?.["datasource"],
      registryUrl: match.groups?.["registryUrl"],
      versioning: match.groups?.["versioning"],
      packageName: match.groups?.["packageName"],
      currentValue: match.groups?.["currentValue"],
      currentDigest: match.groups?.["currentDigest"],
    }),
  );
  const expected = catalog.entries.flatMap((entry) => {
    if (!entry.management.managed) return [];
    const digestSeparator = entry.value.lastIndexOf("@sha256:");
    return [
      {
        depName: entry.name,
        datasource: entry.management.datasource,
        registryUrl: entry.management.registryUrl,
        versioning: entry.management.versioning,
        packageName: entry.management.packageName,
        currentValue:
          digestSeparator === -1
            ? entry.value
            : entry.value.slice(0, digestSeparator),
        currentDigest:
          digestSeparator === -1
            ? undefined
            : entry.value.slice(digestSeparator + 1),
      },
    ];
  });

  expect(actual).toEqual(expected);
  expect(actual).toContainEqual(
    expect.objectContaining({
      depName: "flipt-io/flipt",
      packageName: "flipt/flipt",
    }),
  );
});

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

test("does not query a registry for the repository-owned AsusWRT provider", async () => {
  const config = RenovateConfigSchema.parse(
    await Bun.file(`${root}/renovate.json`).json(),
  );
  const rule = config.packageRules.find(
    (candidate) =>
      candidate.description ===
      "The repository-owned AsusWRT provider is built and installed from packages/terraform-provider-asuswrt; it is intentionally not published to a provider registry.",
  );

  expect(rule).toEqual({
    description:
      "The repository-owned AsusWRT provider is built and installed from packages/terraform-provider-asuswrt; it is intentionally not published to a provider registry.",
    matchDatasources: ["terraform-provider"],
    matchPackageNames: ["shepherdjerred/asuswrt"],
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

test("groups Talos, Kubernetes, and installer updates into one PR", async () => {
  const config = RenovateConfigSchema.parse(
    await Bun.file(`${root}/renovate.json`).json(),
  );
  const rule = config.packageRules.find(
    (candidate) => candidate.groupName === "Talos and Kubernetes",
  );

  expect(rule).toEqual({
    description:
      "Bundle Talos, Kubernetes, and the node installer because they are validated and rolled out together",
    groupName: "Talos and Kubernetes",
    matchPackageNames: [
      "siderolabs/talos",
      "ghcr.io/siderolabs/installer",
      "kubernetes/kubernetes",
    ],
  });
});

test("ignores only the bogus qBittorrent v20 release while retaining semantic tags", async () => {
  const config = RenovateConfigSchema.parse(
    await Bun.file(`${root}/renovate.json`).json(),
  );
  const exactIgnore = config.packageRules.find(
    (candidate) =>
      candidate.description ===
      "Ignore bogus LinuxServer qBittorrent v20 tag; it is not an app release",
  );
  const semanticOnly = config.packageRules.find(
    (candidate) =>
      candidate.description ===
      "Ignore bogus LinuxServer qBittorrent OS tags such as 20.04.1; those are old Ubuntu-based image tags, not qBittorrent app versions",
  );

  expect(exactIgnore).toEqual({
    description:
      "Ignore bogus LinuxServer qBittorrent v20 tag; it is not an app release",
    matchPackageNames: ["linuxserver/qbittorrent"],
    matchNewValue: "/^v?20$/",
    enabled: false,
  });
  expect(semanticOnly).toEqual({
    description:
      "Ignore bogus LinuxServer qBittorrent OS tags such as 20.04.1; those are old Ubuntu-based image tags, not qBittorrent app versions",
    matchPackageNames: ["linuxserver/qbittorrent"],
    allowedVersions: String.raw`/^[0-9]+\.[0-9]+\.[0-9]+$/`,
  });
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
    "6.0.8@sha256:f174124ff798a3ead1abef247d9a849c270b642d552fea500a42565ff210f765",
    "6.0.8@sha256:f174124ff798a3ead1abef247d9a849c270b642d552fea500a42565ff210f765",
  ]);
});
