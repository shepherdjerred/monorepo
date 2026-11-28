import { expect, test } from "vitest";
import { z } from "zod";
import { parseVersionCatalog } from "@shepherdjerred/version-catalog";
import {
  groupNameFor,
  loadRenovateConfig,
  matchesName,
  RenovateConfigSchema,
  root,
  type RegexManager,
  type RenovateConfig,
  type RuleSubject,
} from "./checks/deps/renovate-config.ts";

type HintedPin = {
  file: string;
  datasource: string | undefined;
  depName: string | undefined;
  currentValue: string | undefined;
  currentDigest: string | undefined;
  extractVersion: string | undefined;
  matchedText: string;
};

function hintedPinManager(config: RenovateConfig): RegexManager {
  const manager = config.customManagers.find((candidate) =>
    candidate.description.startsWith("Hinted version pins"),
  );
  if (manager === undefined) {
    throw new Error("Hinted version pin Renovate manager is missing");
  }
  return manager;
}

// Renovate compiles each matchString with the global flag only and reports
// the matches of every expression; file order keeps the table readable.
async function extractPins(
  manager: RegexManager,
  file: string,
): Promise<HintedPin[]> {
  const source = await Bun.file(`${root}/${file}`).text();
  return manager.matchStrings
    .flatMap((expression) => [...source.matchAll(new RegExp(expression, "g"))])
    .toSorted((left, right) => left.index - right.index)
    .map((match) => ({
      file,
      datasource: match.groups?.["datasource"],
      depName: match.groups?.["depName"],
      currentValue: match.groups?.["currentValue"],
      currentDigest: match.groups?.["currentDigest"],
      extractVersion: match.groups?.["extractVersion"],
      matchedText: match[0],
    }));
}

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
  expect(
    actual.filter((entry) => entry.depName?.startsWith("shepherdjerred/")),
  ).toEqual([]);
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
    `${root}/ci/ci-playwright/Dockerfile`,
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
    // The version catalog's cluster-nodes components move with them.
    matchPackageNames: [
      "siderolabs/talos",
      "ghcr.io/siderolabs/installer",
      "kubernetes/kubernetes",
      "siderolabs/installer-liskov",
      "siderolabs/installer-torvalds",
      "siderolabs/kubelet",
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
    matchManagers: ["bun", "npm", "custom.jsonata"],
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
    "Track modern qBittorrent app tags with single-digit majors 4-9. Historical Ubuntu tags use two-digit majors such as 14 and 20; Docker version normalization removes their zero-padded minor, so checking the minor alone cannot reject those stale images.";
  const rules = config.packageRules.filter((candidate) =>
    candidate.matchPackageNames?.includes("linuxserver/qbittorrent"),
  );

  expect(rules).toEqual([
    {
      description,
      matchPackageNames: ["linuxserver/qbittorrent"],
      allowedVersions: String.raw`/^[4-9]\.(0|[1-9][0-9]*)\.[0-9]+$/`,
    },
  ]);

  const allowedVersions = rules[0]?.allowedVersions;
  if (allowedVersions === undefined) {
    throw new Error("qBittorrent rule is missing allowedVersions");
  }
  const allowed = new RegExp(allowedVersions.slice(1, -1));
  expect(allowed.test("20.04.1")).toBe(false);
  expect(allowed.test("20.4.1")).toBe(false);
  expect(allowed.test("14.04.1")).toBe(false);
  expect(allowed.test("14.4.1")).toBe(false);
  expect(allowed.test("5.2.3")).toBe(true);
  expect(allowed.test("5.10.0")).toBe(true);
  expect(allowed.test("6.0.0")).toBe(true);
});

test("keeps Storm tool versions managed at the authoritative Gradle catalog", async () => {
  const config = RenovateConfigSchema.parse(
    await Bun.file(`${root}/renovate.json`).json(),
  );
  const properties = "packages/the-storm/plugin/gradle.properties";
  const rule = config.packageRules.find(
    (candidate) =>
      candidate.matchManagers?.includes("gradle") === true &&
      candidate.matchFileNames?.includes(properties) === true,
  );
  expect(rule?.enabled).toBe(false);
  expect(rule?.matchDepNames).toEqual(["jacoco", "pmd"]);
  expect(rule?.matchFileNames).toEqual([properties]);
  const catalog = "packages/the-storm/plugin/gradle/libs.versions.toml";
  expect(config.ignorePaths).not.toContain(catalog);
  const catalogSource = await Bun.file(`${root}/${catalog}`).text();
  expect(catalogSource).toMatch(/^jacoco = "\d+\.\d+\.\d+"$/m);
  expect(catalogSource).toMatch(/^pmd = "\d+\.\d+\.\d+"$/m);
  for (const line of [
    'pmd-java = { module = "net.sourceforge.pmd:pmd-java", version.ref = "pmd" }',
    'jacoco-agent = { module = "org.jacoco:org.jacoco.agent", version.ref = "jacoco" }',
    'google-java-format = { module = "com.google.googlejavaformat:google-java-format", version.ref = "google-java-format" }',
  ]) {
    expect(catalogSource.split("\n")).toContain(line);
  }
});

test("holds fabric-api to the client Minecraft line, Node 26 tsconfig bases, and groups Bun", async () => {
  const config = await loadRenovateConfig();
  const byName = (name: string) =>
    config.packageRules.filter((rule) =>
      rule.matchPackageNames?.includes(name),
    );
  const fabric = byName("net.fabricmc.fabric-api:fabric-api")[0];
  const allowed = new RegExp(String(fabric?.allowedVersions).slice(1, -1));
  expect(allowed.test("0.165.2+26.3")).toBe(true);
  expect(allowed.test("0.170.0+26.4")).toBe(false);
  const replacement = byName("@tsconfig/node24")[0];
  expect(replacement?.matchUpdateTypes).toEqual(["replacement"]);
  expect(replacement?.enabled).toBe(false);
  expect(byName("@tsconfig/node-lts")[0]?.allowedVersions).toBe("<26");
  const bun = config.packageRules.find((rule) => rule.groupName === "Bun");
  expect(bun?.matchPackageNames).toEqual([
    "bun",
    "oven-sh/bun",
    "oven/bun",
    "@types/bun",
  ]);
  const fixture = config.packageRules.find((rule) =>
    rule.matchFileNames?.includes(
      "scripts/checks/dockerfile-workspace-copies.test.ts",
    ),
  );
  expect(fixture?.enabled).toBe(false);
});

test("updates application Dockerfile tool pins without hardcoded test fixtures", async () => {
  const config = await loadRenovateConfig();
  const manager = hintedPinManager(config);
  const pinsByFile = await Promise.all(
    [
      "packages/discord-plays-pokemon/Dockerfile",
      "packages/streambot/Dockerfile",
    ].map((file) => extractPins(manager, file)),
  );
  const pins = pinsByFile.flat().map(({ depName, currentValue }) => ({
    depName,
    currentValue,
  }));
  expect(pins).toEqual([
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
    matchFileNames: ["packages/streambot/Dockerfile"],
  });
});

test("extracts an Apple codesign version pin from the macOS cross-compiler Dockerfile", async () => {
  const config = await loadRenovateConfig();
  const pins = await extractPins(
    hintedPinManager(config),
    "packages/macos-cross-compiler/Dockerfile",
  );
  const codesign = pins.find(
    (pin) => pin.depName === "indygreg/apple-platform-rs",
  );
  expect(codesign?.datasource).toBe("github-releases");
  expect(codesign?.currentValue).toBe("0.29.0");
  // apple-platform-rs tags every crate it releases; only the codesign tags
  // are versions of this binary.
  expect(codesign?.extractVersion).toBe("^apple-codesign/(?<version>.*)$");
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

test("extracts every OpenTofu provider pin with its registry", async () => {
  const config = RenovateConfigSchema.parse(
    await Bun.file(`${root}/renovate.json`).json(),
  );
  const file = "packages/homelab/src/tofu/provider-versions.json";
  const manager = config.customManagers.find((candidate) =>
    candidate.managerFilePatterns.includes(file),
  );
  const pattern = manager?.matchStrings[0];
  if (pattern === undefined) throw new Error("missing provider pin manager");
  const pins = z
    .object({
      providers: z.array(
        z.looseObject({
          registryUrl: z.string(),
          source: z.string(),
          version: z.string(),
        }),
      ),
    })
    .parse(await Bun.file(`${root}/${file}`).json()).providers;
  const text = await Bun.file(`${root}/${file}`).text();
  const extracted = [...text.matchAll(new RegExp(pattern, "gu"))].map(
    (match) => ({
      registryUrl: match.groups?.["registryUrl"],
      source: match.groups?.["depName"],
      version: match.groups?.["currentValue"],
    }),
  );
  expect(extracted).toEqual(
    pins.map(({ registryUrl, source, version }) => ({
      registryUrl,
      source,
      version,
    })),
  );
  // The repository-built provider is pinned here but has no registry release.
  expect(
    config.packageRules.find((rule) =>
      rule.matchPackageNames?.includes("shepherdjerred/asuswrt"),
    ),
  ).toMatchObject({ matchDatasources: ["terraform-provider"], enabled: false });
});

// Every pin the hinted-pin manager owns. `plain` is a bare version, `v` keeps
// the upstream tag's `v`, `tag` is a whole release tag, and `commit` is a
// branch head with no version at all.
const HINTED_PINS: [
  file: string,
  datasource: string,
  depName: string,
  shape: "plain" | "v" | "tag" | "commit",
][] = [
  ["ci/ci-image/Dockerfile", "github-releases", "jdx/mise", "v"],
  ["ci/ci-image/Dockerfile", "pypi", "uv", "plain"],
  ["ci/ci-playwright/Dockerfile", "github-releases", "jdx/mise", "v"],
  ["ci/scripts/toolchain.sh", "github-releases", "jdx/mise", "v"],
  [
    "packages/delivery/Dockerfile",
    "github-releases",
    "kubernetes/kubernetes",
    "v",
  ],
  ["packages/discord-plays-pokemon/Dockerfile", "pypi", "uv", "plain"],
  ["packages/dotfiles/dot_local/bin/executable_cf", "npm", "cf", "plain"],
  [
    "packages/fonts/patch-berkeley-mono.py",
    "github-releases",
    "ryanoasis/nerd-fonts",
    "v",
  ],
  [
    "packages/macos-cross-compiler/Dockerfile",
    "github-releases",
    "llvm/llvm-project",
    "plain",
  ],
  [
    "packages/macos-cross-compiler/Dockerfile",
    "git-refs",
    "apple-libtapi",
    "commit",
  ],
  [
    "packages/macos-cross-compiler/Dockerfile",
    "git-refs",
    "cctools-port",
    "commit",
  ],
  ["packages/macos-cross-compiler/Dockerfile", "rust-version", "rust", "plain"],
  [
    "packages/macos-cross-compiler/Dockerfile",
    "github-releases",
    "indygreg/apple-platform-rs",
    "plain",
  ],
  [
    "packages/media/Dockerfile",
    "github-releases",
    "theseus-rs/postgresql-binaries",
    "plain",
  ],
  [
    "packages/streambot/Dockerfile",
    "github-releases",
    "yt-dlp/yt-dlp",
    "plain",
  ],
  [
    "packages/tasks-for-obsidian/ios/ci_scripts/mise-native.sh",
    "github-releases",
    "jdx/mise",
    "plain",
  ],
  ["packages/temporal/Dockerfile", "dotnet-version", "dotnet-sdk", "plain"],
  ["packages/temporal/Dockerfile", "github-releases", "cli/cli", "plain"],
  [
    "packages/temporal/Dockerfile",
    "github-releases",
    "kubernetes/kubernetes",
    "v",
  ],
  ["packages/temporal/Dockerfile", "github-releases", "siderolabs/talos", "v"],
  [
    "packages/temporal/Dockerfile",
    "github-releases",
    "opentofu/opentofu",
    "plain",
  ],
  ["packages/temporal/Dockerfile", "github-releases", "argoproj/argo-cd", "v"],
  [
    "packages/temporal/Dockerfile",
    "github-releases",
    "vmware-tanzu/velero",
    "v",
  ],
  [
    "packages/temporal/Dockerfile",
    "github-releases",
    "woodpecker-ci/woodpecker",
    "plain",
  ],
  [
    // github-tags, as the mise manager uses for its copy of this tool: the two
    // datasources date a release differently, so mixing them would let the
    // release-age gate offer each copy a different version.
    "packages/temporal/Dockerfile",
    "github-tags",
    "temporalio/cli",
    "plain",
  ],
  ["packages/temporal/Dockerfile", "github-releases", "grafana/gcx", "plain"],
  ["packages/temporal/Dockerfile", "pypi", "uv", "plain"],
  [
    "packages/temporal/Dockerfile",
    "github-releases",
    "aquasecurity/trivy",
    "plain",
  ],
  [
    "packages/temporal/Dockerfile",
    "github-releases",
    "lycheeverse/lychee",
    "tag",
  ],
  [
    "packages/temporal/Dockerfile",
    "github-tags",
    "Kometa-Team/Kometa",
    "plain",
  ],
  [
    "packages/temporal/Dockerfile",
    "github-releases",
    "theseus-rs/postgresql-binaries",
    "plain",
  ],
  [
    "packages/toolkit/src/lib/brim/capture/engine.ts",
    "pypi",
    "mitmproxy",
    "plain",
  ],
  [
    "packages/toolkit/src/lib/brim/capture/engine.ts",
    "python-version",
    "python",
    "plain",
  ],
  [
    "packages/windows-cross-compiler/Dockerfile",
    "github-tags",
    "wine-mirror/wine",
    "plain",
  ],
  [
    "packages/windows-cross-compiler/Dockerfile",
    "dotnet-version",
    "dotnet-sdk",
    "plain",
  ],
  [
    "packages/windows-cross-compiler/Dockerfile",
    "rust-version",
    "rust",
    "plain",
  ],
  [
    "packages/windows-cross-compiler/Dockerfile",
    "github-tags",
    "rust-lang/rustup",
    "plain",
  ],
  [
    "packages/windows-cross-compiler/Dockerfile",
    "github-releases",
    "rust-cross/cargo-xwin",
    "plain",
  ],
  [
    "packages/windows-cross-compiler/Dockerfile",
    "deb",
    "winehq-stable",
    "plain",
  ],
  [
    "packages/windows-cross-compiler/Dockerfile",
    "github-tags",
    "Winetricks/winetricks",
    "plain",
  ],
  ["scripts/misc/migration-core.ts", "npm", "pyright", "plain"],
  ["scripts/tools/ruff-check.ts", "pypi", "ruff", "plain"],
];

const PIN_SHAPES = {
  plain: /^\d[\w.~-]*$/,
  v: /^v\d[\w.-]*$/,
  tag: /^[a-z][a-z-]*-v\d[\w.-]*$/,
} as const;

async function extractHintedPinTable(
  config: RenovateConfig,
): Promise<HintedPin[]> {
  const manager = hintedPinManager(config);
  const files = [...new Set(HINTED_PINS.map(([file]) => file))];
  const pinsByFile = await Promise.all(
    files.map((file) => extractPins(manager, file)),
  );
  return pinsByFile.flat();
}

function miseManager(config: RenovateConfig): RegexManager {
  const manager = config.customManagers.find((candidate) =>
    candidate.managerFilePatterns.includes(".mise.toml"),
  );
  if (manager === undefined) {
    throw new Error(".mise.toml Renovate manager is missing");
  }
  return manager;
}

test("extracts every hinted version pin and nothing else from those files", async () => {
  const pins = await extractHintedPinTable(await loadRenovateConfig());

  expect(
    pins.map(({ file, datasource, depName }) => [file, datasource, depName]),
  ).toEqual(
    HINTED_PINS.map(([file, datasource, depName]) => [
      file,
      datasource,
      depName,
    ]),
  );
  for (const [index, [file, , depName, shape]] of HINTED_PINS.entries()) {
    const pin = pins[index];
    if (pin === undefined) {
      throw new Error(`Missing extracted pin for ${depName} in ${file}`);
    }
    if (shape === "commit") {
      expect(pin.currentValue).toBeUndefined();
      expect(pin.currentDigest).toMatch(/^[a-f0-9]{40}$/);
    } else {
      expect(pin.currentValue).toMatch(PIN_SHAPES[shape]);
    }
  }

  // Kometa is cloned at a tag and verified against that tag's commit, so the
  // version and the commit must sit in one match to move together.
  const kometa = pins.find((pin) => pin.depName === "Kometa-Team/Kometa");
  expect(kometa?.currentDigest).toMatch(/^[a-f0-9]{40}$/);
  expect(kometa?.extractVersion).toBe(String.raw`^v(?<version>\d+\.\d+\.\d+)$`);
  expect(
    pins.filter(
      (pin) =>
        pin.currentDigest !== undefined && pin.currentValue !== undefined,
    ),
  ).toEqual([kometa]);
});

test("rewrites only the pin when Renovate replaces a hinted value", async () => {
  // Renovate replaces every occurrence of the value inside the matched text,
  // so a hint or neighbouring line that repeats it would be rewritten too.
  const pins = await extractHintedPinTable(await loadRenovateConfig());
  for (const pin of pins) {
    for (const value of [pin.currentValue, pin.currentDigest]) {
      if (value === undefined) continue;
      expect(
        pin.matchedText.split(value),
        `${pin.depName ?? "?"} in ${pin.file}`,
      ).toHaveLength(2);
    }
  }
});

test("tracks the mise pins the native manager cannot resolve", async () => {
  const config = await loadRenovateConfig();
  expect(hintedPinManager(config).managerFilePatterns).not.toContain(
    ".mise.toml",
  );

  const pins = await extractPins(miseManager(config), ".mise.toml");
  expect(
    pins.map(({ datasource, depName, currentValue }) => ({
      datasource,
      depName,
      currentValue,
    })),
  ).toEqual([
    {
      datasource: "dotnet-version",
      depName: "dotnet-sdk",
      currentValue: expect.stringMatching(/^\d+\.\d+\.\d+$/),
    },
    {
      datasource: "github-releases",
      depName: "corretto/corretto-25",
      currentValue: expect.stringMatching(/^\d+(?:\.\d+){4}$/),
    },
  ]);

  // Native mise tracks every other tool, so a hint above one would be dead.
  const source = await Bun.file(`${root}/.mise.toml`).text();
  expect(source.match(/^# renovate:/gm)).toHaveLength(pins.length);

  expect(
    config.packageRules.find(
      (rule) =>
        rule.matchManagers?.includes("mise") === true &&
        rule.matchDepNames?.includes("dotnet") === true,
    ),
  ).toMatchObject({ matchFileNames: [".mise.toml"], enabled: false });
});

test("moves pins that must stay equal in one Renovate branch", async () => {
  const config = await loadRenovateConfig();
  const pins = [
    ...(await extractHintedPinTable(config)),
    ...(await extractPins(miseManager(config), ".mise.toml")),
  ];

  function extracted(file: string, depName: string): RuleSubject {
    const pin = pins.find(
      (candidate) => candidate.file === file && candidate.depName === depName,
    );
    if (pin?.datasource === undefined) {
      throw new Error(`No hinted pin for ${depName} in ${file}`);
    }
    return {
      manager: "custom.regex",
      file,
      datasource: pin.datasource,
      depName,
      packageName: depName,
    };
  }
  // Renovate's native managers name these themselves: the mise manager maps a
  // tool to its upstream datasource and package, and the nuget manager reads
  // the SDK from global.json.
  const miseRust: RuleSubject = {
    manager: "mise",
    file: ".mise.toml",
    datasource: "rust-version",
    depName: "rust",
    packageName: "rust",
  };
  const globalJsonSdk: RuleSubject = {
    manager: "nuget",
    file: "global.json",
    datasource: "dotnet-version",
    depName: "dotnet-sdk",
    packageName: "dotnet-sdk",
  };
  const miseOpenTofu: RuleSubject = {
    manager: "mise",
    file: ".mise.toml",
    datasource: "github-releases",
    depName: "opentofu",
    packageName: "opentofu/opentofu",
  };
  const misePostgres: RuleSubject = {
    manager: "mise",
    file: ".mise.toml",
    datasource: "github-releases",
    depName: "github:theseus-rs/postgresql-binaries",
    packageName: "theseus-rs/postgresql-binaries",
  };

  const windows = "packages/windows-cross-compiler/Dockerfile";
  const macos = "packages/macos-cross-compiler/Dockerfile";
  const temporal = "packages/temporal/Dockerfile";
  const groups: Record<string, RuleSubject[]> = {
    "Rust toolchain": [
      miseRust,
      extracted(macos, "rust"),
      extracted(windows, "rust"),
    ],
    ".NET SDK": [
      globalJsonSdk,
      extracted(".mise.toml", "dotnet-sdk"),
      extracted(windows, "dotnet-sdk"),
      extracted(temporal, "dotnet-sdk"),
    ],
    OpenTofu: [miseOpenTofu, extracted(temporal, "opentofu/opentofu")],
    mise: [
      extracted("ci/ci-image/Dockerfile", "jdx/mise"),
      extracted("ci/ci-playwright/Dockerfile", "jdx/mise"),
      extracted("ci/scripts/toolchain.sh", "jdx/mise"),
    ],
    "postgresql-binaries": [
      misePostgres,
      extracted(temporal, "theseus-rs/postgresql-binaries"),
      extracted("packages/media/Dockerfile", "theseus-rs/postgresql-binaries"),
    ],
    "Talos and Kubernetes": [
      extracted(temporal, "siderolabs/talos"),
      extracted(temporal, "kubernetes/kubernetes"),
      extracted("packages/delivery/Dockerfile", "kubernetes/kubernetes"),
    ],
    Wine: [
      extracted(windows, "wine-mirror/wine"),
      extracted(windows, "winehq-stable"),
    ],
    "Apple cctools sources": [
      extracted(macos, "apple-libtapi"),
      extracted(macos, "cctools-port"),
    ],
  };

  for (const [groupName, subjects] of Object.entries(groups)) {
    for (const subject of subjects) {
      expect(
        groupNameFor(config.packageRules, subject),
        `${subject.depName} in ${subject.file}`,
      ).toBe(groupName);
    }
  }

  // The sync checks compare these values literally, so the hinted copies
  // must already be equal for one branch to keep them equal.
  for (const groupName of ["Rust toolchain", ".NET SDK", "mise"]) {
    const values = new Set(
      pins
        .filter((pin) =>
          groups[groupName]?.some(
            (subject) =>
              subject.manager === "custom.regex" &&
              subject.file === pin.file &&
              subject.depName === pin.depName,
          ),
        )
        .map((pin) => pin.currentValue),
    );
    expect(values.size, groupName).toBe(1);
  }
});

test("names the companion a reviewer must refresh on a half upgrade", async () => {
  const config = await loadRenovateConfig();
  const notes = (packageName: string, file: string): string =>
    config.packageRules
      .filter(
        (rule) =>
          rule.prBodyNotes !== undefined &&
          matchesName(rule.matchPackageNames, packageName) &&
          matchesName(rule.matchFileNames, file),
      )
      .flatMap((rule) => rule.prBodyNotes ?? [])
      .join("\n");
  const windows = "packages/windows-cross-compiler/Dockerfile";

  expect(notes("dotnet-sdk", windows)).toContain("DOTNET_SDK_SHA512_AMD64");
  expect(notes("jdx/mise", "ci/scripts/toolchain.sh")).toContain(
    "MISE_BOOTSTRAP_SHA256",
  );
  expect(notes("wine-mirror/wine", windows)).toContain("WINE_SOURCE_SHA256");
  for (const packageName of [
    "rust-lang/rustup",
    "rust-cross/cargo-xwin",
    "Winetricks/winetricks",
  ]) {
    expect(notes(packageName, windows)).toContain("_SHA256");
  }
  expect(
    notes("ryanoasis/nerd-fonts", "packages/fonts/patch-berkeley-mono.py"),
  ).toContain("FONT_PATCHER_SHA256");
  expect(
    notes("argo-cd", "packages/version-catalog/src/catalog.json"),
  ).toContain("ARGOCD_CLI_VERSION");
  expect(
    notes("argo-cd", "packages/version-catalog/src/catalog.json"),
  ).toContain(".mise.toml");

  // Each named companion must exist where the note says it does.
  const windowsSource = await Bun.file(`${root}/${windows}`).text();
  expect(windowsSource).toContain("ARG DOTNET_SDK_SHA512_AMD64=");
  expect(windowsSource).toContain("ARG WINE_SOURCE_SHA256=");
  const temporalDockerfile = await Bun.file(
    `${root}/packages/temporal/Dockerfile`,
  ).text();
  expect(temporalDockerfile).toContain("ARG DOTNET_SDK_SHA512_ARM64=");
  expect(temporalDockerfile).toContain("ARG ARGOCD_CLI_VERSION=");
  expect(await Bun.file(`${root}/.mise.toml`).text()).toMatch(
    /^argocd = "\d+\.\d+\.\d+"$/m,
  );
  expect(await Bun.file(`${root}/ci/scripts/toolchain.sh`).text()).toContain(
    "MISE_BOOTSTRAP_SHA256=",
  );
  expect(
    await Bun.file(`${root}/packages/fonts/patch-berkeley-mono.py`).text(),
  ).toContain("FONT_PATCHER_SHA256");
});

test("releases timestamp-less datasources and Docker digest refreshes from the release-age gate", async () => {
  const config = await loadRenovateConfig();
  const rule = config.packageRules.find(
    (candidate) =>
      candidate.matchDatasources?.includes("git-refs") === true &&
      candidate.minimumReleaseAge !== undefined,
  );

  expect(rule?.matchDatasources).toEqual(["deb", "git-refs"]);
  expect(rule?.minimumReleaseAge).toBe("0 days");
  expect(rule?.matchPackageNames).toBeUndefined();

  const dockerDigestRule = config.packageRules.find(
    (candidate) =>
      candidate.matchDatasources?.includes("docker") === true &&
      candidate.matchUpdateTypes?.includes("digest") === true,
  );
  expect(dockerDigestRule).toEqual({
    description:
      "Docker digest-only updates refresh the digest of an already-pinned tag and often carry no registry release timestamp. Under the strict 30-day release-age gate they stay pending forever, so digest updates skip the gate while tag bumps still wait.",
    matchDatasources: ["docker"],
    matchUpdateTypes: ["digest"],
    minimumReleaseAge: "0 days",
  });
});

test("does not look up Storm artifacts that Maven Central cannot resolve", async () => {
  const config = await loadRenovateConfig();
  for (const packageName of [
    "ac.grim.artifact:grimac-bukkit",
    "com.mojang:minecraft",
  ]) {
    expect(
      config.packageRules.find((rule) =>
        rule.matchPackageNames?.includes(packageName),
      ),
    ).toMatchObject({
      matchManagers: ["gradle"],
      matchDatasources: ["maven"],
      matchFileNames: ["packages/the-storm/**"],
      enabled: false,
    });
  }
  const catalog = await Bun.file(
    `${root}/packages/the-storm/plugin/gradle/libs.versions.toml`,
  ).text();
  expect(catalog).toContain("ac.grim.artifact:grimac-bukkit");
  expect(catalog).toContain("com.mojang:minecraft");
});

test("keeps every custom manager expression within RE2 syntax", async () => {
  // Renovate compiles these with RE2, which has no lookaround and no
  // backreferences; it would reject such an expression at run time.
  const raw = z
    .object({
      customManagers: z.array(
        z.looseObject({ matchStrings: z.array(z.string()) }),
      ),
    })
    .parse(await Bun.file(`${root}/renovate.json`).json());
  const expressions = raw.customManagers.flatMap((manager) => [
    ...manager.matchStrings,
    ...Object.entries(manager)
      .filter(([key]) => key.endsWith("Template"))
      .flatMap(([, value]) => (typeof value === "string" ? [value] : [])),
  ]);

  expect(expressions.length).toBeGreaterThan(0);
  for (const expression of expressions) {
    expect(expression).not.toMatch(/\(\?<?[=!]/);
    expect(expression).not.toMatch(/\\[1-9]/);
  }
});
