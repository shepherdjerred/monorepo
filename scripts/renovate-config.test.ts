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
  dependencyDashboardApproval: z.boolean(),
  automerge: z.boolean(),
  automergeStrategy: z.string().optional(),
  platformAutomerge: z.boolean(),
  rebaseWhen: z.string(),
  vulnerabilityAlerts: z.object({
    enabled: z.boolean(),
  }),
  osvVulnerabilityAlerts: z.boolean(),
  env: z.record(z.string(), z.string()),
  mode: z.string().optional(),
  schedule: z.array(z.string()),
  commitHourlyLimit: z.number().optional(),
  prHourlyLimit: z.number(),
  prConcurrentLimit: z.number(),
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

test("uses Renovate as a manually approved dependency dashboard", async () => {
  const config = RenovateConfigSchema.parse(
    await Bun.file(`${root}/renovate.json`).json(),
  );

  expect(config).toMatchObject({
    dependencyDashboardApproval: true,
    automerge: false,
    platformAutomerge: false,
    rebaseWhen: "never",
    vulnerabilityAlerts: {
      enabled: false,
    },
    osvVulnerabilityAlerts: false,
    schedule: ["after 3am on Sunday"],
    prHourlyLimit: 5,
    prConcurrentLimit: 3,
  });
  expect(config.automergeStrategy).toBeUndefined();
  expect(config.mode).toBeUndefined();
  expect(config.commitHourlyLimit).toBeUndefined();
  expect(config.env).toEqual({
    BUN_CONFIG_MAX_HTTP_REQUESTS: "4",
  });
});

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
  const nginx = expected.find((entry) => entry.depName === "library/nginx");
  if (nginx === undefined) {
    throw new Error("Managed nginx catalog entry is missing");
  }
  expect(nginx).toMatchObject({
    datasource: "docker",
    versioning: "docker",
  });
  expect(nginx.currentValue).toMatch(/^\d+\.\d+\.\d+-alpine$/);
  expect(actual).toContainEqual(nginx);
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
    matchManagers: ["bun", "npm"],
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
    minimumReleaseAge: "0 days",
  });
});

test("groups the AI SDK so ai and @ai-sdk/otel bump together", async () => {
  const config = RenovateConfigSchema.parse(
    await Bun.file(`${root}/renovate.json`).json(),
  );
  const rule = config.packageRules.find(
    (candidate) => candidate.groupName === "AI SDK",
  );

  expect(rule?.matchPackageNames).toEqual(["ai", "@ai-sdk/**"]);
});

test("keeps direct TypeScript on 6 without constraining the native alias", async () => {
  const config = RenovateConfigSchema.parse(
    await Bun.file(`${root}/renovate.json`).json(),
  );
  const rule = config.packageRules.find(
    (candidate) =>
      candidate.description ===
      "Native TypeScript 7 owns typechecking; keep direct TypeScript on 6 for typescript-eslint project service, Astro Check, Twoslash, and TypeDoc.",
  );

  expect(rule).toEqual({
    description:
      "Native TypeScript 7 owns typechecking; keep direct TypeScript on 6 for typescript-eslint project service, Astro Check, Twoslash, and TypeDoc.",
    groupName: "typescript",
    matchManagers: ["bun", "npm"],
    matchDepNames: ["typescript"],
    allowedVersions: "<7",
  });
  expect(rule?.matchDepNames).not.toContain("@typescript/native");
});

test("keeps the custom Corretto manager authoritative for mise Java", async () => {
  const config = RenovateConfigSchema.parse(
    await Bun.file(`${root}/renovate.json`).json(),
  );
  const rule = config.packageRules.find(
    (candidate) =>
      candidate.description ===
      "Keep the custom Corretto regex manager authoritative; disable only the native mise java dependency so Renovate cannot replace Corretto with another JDK distribution.",
  );

  expect(rule).toEqual({
    description:
      "Keep the custom Corretto regex manager authoritative; disable only the native mise java dependency so Renovate cannot replace Corretto with another JDK distribution.",
    matchManagers: ["mise"],
    matchDepNames: ["java"],
    matchFileNames: [".mise.toml"],
    enabled: false,
  });
});

test("rejects stale qBittorrent Ubuntu tags while retaining semantic app tags", async () => {
  const config = RenovateConfigSchema.parse(
    await Bun.file(`${root}/renovate.json`).json(),
  );
  const description =
    "Ignore bogus LinuxServer qBittorrent OS tags such as 20.04.1; those are stale Ubuntu YY.MM-based image tags, not qBittorrent app versions. qBittorrent never zero-pads its minor version, so rejecting a leading-zero minor excludes them while keeping every semantic app tag.";
  const rules = config.packageRules.filter((candidate) =>
    candidate.matchPackageNames?.includes("linuxserver/qbittorrent"),
  );

  expect(rules).toEqual([
    {
      description,
      matchPackageNames: ["linuxserver/qbittorrent"],
      allowedVersions: String.raw`/^[0-9]+\.(0|[1-9][0-9]*)\.[0-9]+$/`,
    },
  ]);

  const allowedVersions = rules[0]?.allowedVersions;
  if (allowedVersions === undefined) {
    throw new Error("qBittorrent rule is missing allowedVersions");
  }
  const allowed = new RegExp(allowedVersions.slice(1, -1));
  expect(allowed.test("20.04.1")).toBe(false);
  expect(allowed.test("5.2.3")).toBe(true);
  expect(allowed.test("5.10.0")).toBe(true);
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
    { depName: "uv", currentValue: expect.stringMatching(/^\d/) },
    { depName: "yt-dlp/yt-dlp", currentValue: expect.stringMatching(/^\d/) },
    {
      depName: "realm/SwiftLint",
      currentValue: expect.stringMatching(/^\d/),
    },
    { depName: "uv", currentValue: expect.stringMatching(/^\d/) },
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
    matchFileNames: ["packages/streambot/Dockerfile"],
  });
});

test("keeps the SwiftLint version pin synchronized between the ci-image Dockerfile and its toolchain-script fallback", async () => {
  const config = RenovateConfigSchema.parse(
    await Bun.file(`${root}/renovate.json`).json(),
  );

  const dockerfileManager = config.customManagers.find((candidate) =>
    candidate.managerFilePatterns.includes(".buildkite/ci-image/Dockerfile"),
  );
  if (dockerfileManager === undefined) {
    throw new Error("ci-image Dockerfile ARG Renovate manager is missing");
  }
  const dockerfileExpression = dockerfileManager.matchStrings[0];
  if (dockerfileExpression === undefined) {
    throw new Error("ci-image Dockerfile ARG matcher is missing");
  }
  const dockerfileSource = await Bun.file(
    `${root}/.buildkite/ci-image/Dockerfile`,
  ).text();
  const dockerfilePin = [
    ...dockerfileSource.matchAll(new RegExp(dockerfileExpression, "gm")),
  ].find((match) => match.groups?.["depName"] === "realm/SwiftLint");
  const dockerfileValue = dockerfilePin?.groups?.["currentValue"];
  if (dockerfileValue === undefined) {
    throw new Error("ci-image Dockerfile did not yield a realm/SwiftLint pin");
  }

  const scriptManager = config.customManagers.find((candidate) =>
    candidate.managerFilePatterns.includes(".buildkite/scripts/toolchain.sh"),
  );
  if (scriptManager === undefined) {
    throw new Error("toolchain.sh SwiftLint Renovate manager is missing");
  }
  const scriptExpression = scriptManager.matchStrings[0];
  if (scriptExpression === undefined) {
    throw new Error("toolchain.sh SwiftLint matcher is missing");
  }
  const scriptSource = await Bun.file(
    `${root}/.buildkite/scripts/toolchain.sh`,
  ).text();
  const scriptMatch = new RegExp(scriptExpression).exec(scriptSource);
  const scriptValue = scriptMatch?.groups?.["currentValue"];
  if (scriptValue === undefined) {
    throw new Error("toolchain.sh did not yield a SwiftLint pin");
  }

  expect(scriptValue).toBe(dockerfileValue);
  expect(scriptValue).toBe("0.61.0");

  const swiftlintRule = config.packageRules.find(
    (candidate) => candidate.groupName === "SwiftLint",
  );
  expect(swiftlintRule).toEqual({
    description:
      "Keep the SwiftLint version pin synchronized between the ci-image Dockerfile ARG and its toolchain-script fallback",
    groupName: "SwiftLint",
    matchDepNames: ["realm/SwiftLint"],
  });
});

test("extracts an Apple codesign version pin from the macOS cross-compiler Dockerfile", async () => {
  const config = RenovateConfigSchema.parse(
    await Bun.file(`${root}/renovate.json`).json(),
  );
  const manager = config.customManagers.find((candidate) =>
    candidate.managerFilePatterns.includes(
      "packages/macos-cross-compiler/Dockerfile",
    ),
  );
  if (manager === undefined) {
    throw new Error("Apple codesign Renovate manager is missing");
  }
  const expression = manager.matchStrings[0];
  if (expression === undefined) {
    throw new Error("Apple codesign matcher is missing");
  }
  const source = await Bun.file(
    `${root}/packages/macos-cross-compiler/Dockerfile`,
  ).text();
  const match = new RegExp(expression).exec(source);
  expect(match?.groups?.["depName"]).toBe("indygreg/apple-platform-rs");
  expect(match?.groups?.["currentValue"]).toBe("0.29.0");
});

test("extracts identical Swift base image digest pins from both sources", async () => {
  const config = RenovateConfigSchema.parse(
    await Bun.file(`${root}/renovate.json`).json(),
  );
  const manager = config.customManagers.find(
    (candidate) => candidate.depNameTemplate === "swift",
  );
  if (manager === undefined) {
    throw new Error("Swift base image Renovate manager is missing");
  }

  const sources = [
    await Bun.file(`${root}/packages/macos-cross-compiler/sdks.json`).text(),
    await Bun.file(`${root}/packages/macos-cross-compiler/Dockerfile`).text(),
  ];
  expect(manager.matchStrings).toHaveLength(2);
  expect(manager.matchStrings[0]).toContain("swiftImage");
  expect(manager.matchStrings[1]).toContain("SWIFT_IMAGE");

  const expressions = [
    /"swiftImage":\s*"swift:(?<currentValue>[^@"]+)@(?<currentDigest>sha256:[a-f0-9]{64})"/,
    /ARG\s+SWIFT_IMAGE=swift:(?<currentValue>[^@\s]+)@(?<currentDigest>sha256:[a-f0-9]{64})/,
  ];
  const pins = expressions.flatMap((expression, index) => {
    const source = sources[index];
    if (source === undefined) {
      throw new Error(
        `Missing Swift source for expression ${index.toString()}`,
      );
    }
    const match = expression.exec(source);
    const currentValue = match?.groups?.["currentValue"];
    const currentDigest = match?.groups?.["currentDigest"];
    if (currentValue === undefined || currentDigest === undefined) {
      throw new Error(
        `Swift expression ${index.toString()} did not extract a complete pin`,
      );
    }
    return [`${currentValue}@${currentDigest}`];
  });

  expect(manager.managerFilePatterns).toEqual([
    "packages/macos-cross-compiler/sdks.json",
    "packages/macos-cross-compiler/Dockerfile",
  ]);
  expect(pins[0]).toEqual(pins[1]);
});

test("groups eslint and prettier bumps across the workspace into single PRs", async () => {
  const config = RenovateConfigSchema.parse(
    await Bun.file(`${root}/renovate.json`).json(),
  );
  const eslintRule = config.packageRules.find(
    (candidate) => candidate.groupName === "eslint",
  );
  const prettierRule = config.packageRules.find(
    (candidate) => candidate.groupName === "prettier",
  );
  expect(eslintRule?.matchDepNames).toEqual(["eslint"]);
  expect(prettierRule?.matchDepNames).toEqual(["prettier"]);
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
    "6.0.10@sha256:e077d54e2b8970575ebc4f185ac1de0b95c05f2b266134d4ba27449af7aebf65",
    "6.0.10@sha256:e077d54e2b8970575ebc4f185ac1de0b95c05f2b266134d4ba27449af7aebf65",
  ]);
});
