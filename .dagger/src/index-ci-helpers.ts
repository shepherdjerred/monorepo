import type { Secret, Directory, Container } from "@dagger.io/dagger";
import {
  getBaseBunDebianContainer,
  installMonorepoWorkspaceDeps,
} from "./lib-monorepo-workspace.ts";
import type { WorkspaceEntry } from "./lib-monorepo-workspace.ts";
import { checkAstroOpengraphImages } from "./astro-opengraph-images.ts";
import { checkWebring } from "./webring.ts";
import { checkStarlightKarmaBot } from "./starlight-karma-bot.ts";
import { checkBetterSkillCapped } from "./better-skill-capped.ts";
import { checkSjerRed } from "./sjer-red.ts";
import { checkCastleCasters } from "./castle-casters.ts";
import { checkMacosCrossCompiler } from "./macos-cross-compiler.ts";
import { checkDiscordPlaysPokemon } from "./discord-plays-pokemon.ts";
import { checkScoutForLol } from "./scout-for-lol.ts";
import { checkHomelab } from "./homelab-index.ts";
import {
  runReleasePleasePr,
  runReleasePleaseGithubRelease,
  publishNpmPackages,
  runAppDeployments,
  runHomelabRelease,
  runVersionCommitBack,
  runClauderonRelease,
} from "./index-release-helpers.ts";

/**
 * All workspace entries for the main CI container.
 */
export const CI_WORKSPACES: WorkspaceEntry[] = [
  "packages/birmel",
  "packages/bun-decompile",
  "packages/eslint-config",
  { path: "packages/resume", depsOnly: true },
  "packages/tools",
  {
    path: "packages/clauderon/web",
    depsOnly: true,
    extraFiles: ["packages/clauderon/web/bun.lock"],
    subPackages: [
      "packages/clauderon/web/shared",
      "packages/clauderon/web/client",
      "packages/clauderon/web/frontend",
    ],
  },
  "packages/clauderon/web/shared",
  "packages/clauderon/web/client",
  "packages/clauderon/web/frontend",
  { path: "packages/clauderon/docs", fullDirPhase1: true },
  "packages/astro-opengraph-images",
  {
    path: "packages/better-skill-capped",
    subPackages: ["packages/better-skill-capped/fetcher"],
  },
  "packages/sjer.red",
  "packages/webring",
  "packages/starlight-karma-bot",
  {
    path: "packages/homelab",
    extraFiles: [
      "packages/homelab/patches/@digital-alchemy%2Ftype-writer@25.10.12.patch",
    ],
    subPackages: [
      "packages/homelab/src/cdk8s",
      "packages/homelab/src/deps-email",
      "packages/homelab/src/ha",
      "packages/homelab/src/helm-types",
    ],
  },
  {
    path: "packages/discord-plays-pokemon",
    subPackages: [
      "packages/discord-plays-pokemon/packages/backend",
      "packages/discord-plays-pokemon/packages/common",
      "packages/discord-plays-pokemon/packages/frontend",
    ],
  },
  {
    path: "packages/scout-for-lol",
    extraFiles: [
      "packages/scout-for-lol/patches/satori@0.18.3.patch",
    ],
    subPackages: [
      "packages/scout-for-lol/packages/backend",
      "packages/scout-for-lol/packages/data",
      "packages/scout-for-lol/packages/desktop",
      "packages/scout-for-lol/packages/frontend",
      "packages/scout-for-lol/packages/report",
      "packages/scout-for-lol/packages/ui",
    ],
  },
];

/**
 * Install workspace dependencies with optimal layer ordering.
 */
export function installWorkspaceDeps(source: Directory): Container {
  return installMonorepoWorkspaceDeps({
    baseContainer: getBaseBunDebianContainer(),
    source,
    useMounts: true,
    workspaces: CI_WORKSPACES,
    rootConfigFiles: ["tsconfig.base.json"],
  })
    // Mount scripts directory (root package.json scripts reference scripts/run-package-script.ts)
    .withMountedDirectory("/workspace/scripts", source.directory("scripts"));
}

/**
 * Set up Prisma clients for Birmel and Scout-for-LoL.
 */
export async function setupPrisma(
  container: Container,
): Promise<{ container: Container; outputs: string[] }> {
  const outputs: string[] = [];

  let c = container.withExec([
    "rm",
    "-rf",
    "packages/birmel/node_modules/.prisma",
  ]);

  // Birmel Prisma
  c = c
    .withWorkdir("/workspace/packages/birmel")
    .withEnvVariable(
      "DATABASE_URL",
      "file:/workspace/packages/birmel/data/test-ops.db",
    )
    .withEnvVariable(
      "OPS_DATABASE_URL",
      "file:/workspace/packages/birmel/data/test-ops.db",
    )
    .withExec(["bunx", "prisma", "generate"])
    .withExec([
      "bunx",
      "prisma",
      "db",
      "push",
      "--accept-data-loss",
    ])
    .withWorkdir("/workspace");

  // Scout-for-LoL Prisma
  c = c
    .withWorkdir("/workspace/packages/scout-for-lol/packages/backend")
    .withEnvVariable(
      "DATABASE_URL",
      "file:/workspace/packages/scout-for-lol/packages/backend/data/test.db",
    )
    .withExec(["bunx", "prisma", "generate"])
    .withWorkdir("/workspace");

  await c.sync();
  outputs.push("✓ Prisma setup (birmel + scout-for-lol)");

  return { container: c, outputs };
}

/**
 * Build clauderon web packages and extract frontend dist.
 */
export async function buildClauderonWeb(
  container: Container,
  rustContainer: Container,
): Promise<{ container: Container; frontendDist: Directory; outputs: string[] }> {
  const outputs: string[] = [];

  const generatedTypes = rustContainer.directory(
    "/workspace/web/shared/src/generated",
  );
  let c = container.withDirectory(
    "/workspace/packages/clauderon/web/shared/src/generated",
    generatedTypes,
  );

  c = c
    .withWorkdir("/workspace/packages/clauderon/web/shared")
    .withExec(["bun", "run", "build"])
    .withWorkdir("/workspace/packages/clauderon/web/client")
    .withExec(["bun", "run", "build"])
    .withWorkdir("/workspace/packages/clauderon/web/frontend")
    .withExec(["bun", "run", "build"])
    .withWorkdir("/workspace");
  await c.sync();
  outputs.push("✓ TypeScript types generated and web packages built");

  const frontendDist = c.directory(
    "/workspace/packages/clauderon/web/frontend/dist",
  );

  return { container: c, frontendDist, outputs };
}

/**
 * Retry a check if it fails with a transient Dagger graphql error.
 */
async function withGraphqlRetry<T>(
  name: string,
  fn: () => Promise<T>,
  maxRetries = 2,
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const isGraphqlError = msg.includes("unknown error while requesting data via graphql");
      if (!isGraphqlError || attempt === maxRetries) {
        throw error;
      }
      console.log(`⟳ ${name}: graphql error on attempt ${String(attempt + 1)}, retrying...`);
    }
  }
  throw new Error("unreachable");
}

/**
 * Run package-specific validation checks in parallel.
 */
export async function runPackageValidation(
  source: Directory,
  hassBaseUrl?: Secret,
  hassToken?: Secret,
): Promise<{ outputs: string[]; errors: string[] }> {
  const outputs: string[] = [];
  const errors: string[] = [];

  // Run most checks in parallel. Scout-for-lol is excluded because its
  // complex DAG (Prisma + eslint-config build + desktop Rust) consistently
  // triggers Dagger engine graphql errors when launched alongside 8+ other
  // parallel DAGs. Running it separately reduces engine query pressure.
  const mainResults = await Promise.allSettled([
    checkAstroOpengraphImages(source),
    checkWebring(source),
    checkStarlightKarmaBot(source),
    checkBetterSkillCapped(source),
    checkSjerRed(source),
    checkDiscordPlaysPokemon(source),
    checkCastleCasters(source),
    checkHomelab(source, hassBaseUrl, hassToken),
  ]);

  for (const result of mainResults) {
    if (result.status === "fulfilled") {
      outputs.push(result.value);
    } else {
      const msg =
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason);
      outputs.push(`✗ ${msg}`);
      errors.push(msg);
    }
  }

  // Run scout-for-lol separately with retry to avoid graphql errors
  try {
    outputs.push(await withGraphqlRetry("scout-for-lol", () => checkScoutForLol(source)));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    outputs.push(`✗ scout-for-lol: ${msg}`);
    errors.push(`scout-for-lol: ${msg}`);
  }

  // macos-cross-compiler: non-blocking due to very long build time
  try {
    outputs.push(await checkMacosCrossCompiler(source));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    outputs.push(`⚠ macos-cross-compiler (non-blocking): ${msg}`);
  }

  return { outputs, errors };
}

/**
 * Collect tier 0 results, wrapping each in try-catch so one failure
 * doesn't prevent collecting others. Returns outputs and errors separately.
 */
export async function collectTier0Results(tier0: {
  compliance: Promise<string>;
  mobile: Promise<string>;
  birmel: Promise<string>;
  packages: Promise<string>;
  quality: Promise<string>;
}): Promise<{ outputs: string[]; errors: string[] }> {
  const outputs: string[] = [];
  const errors: string[] = [];

  const steps: { name: string; promise: Promise<string>; group: string | undefined }[] = [
    { name: "Compliance", promise: tier0.compliance, group: undefined },
    { name: "Mobile CI", promise: tier0.mobile, group: "Clauderon Mobile Validation" },
    { name: "Birmel", promise: tier0.birmel, group: "Birmel Validation" },
    { name: "Packages", promise: tier0.packages, group: "Package Validation" },
    { name: "Quality", promise: tier0.quality, group: "Quality & Security Checks" },
  ];

  for (const step of steps) {
    if (step.group !== undefined) {
      outputs.push(`::group::${step.group}`);
    }
    try {
      outputs.push(await step.promise);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      errors.push(`${step.name}: ${msg}`);
      outputs.push(`✗ ${step.name}: ${msg}`);
    }
    if (step.group !== undefined) {
      outputs.push("::endgroup::");
    }
  }

  return { outputs, errors };
}

/**
 * Options for the release phase
 */
export type ReleasePhaseOptions = {
  source: Directory;
  container: Container;
  githubToken: Secret;
  npmToken: Secret;
  version?: string | undefined;
  gitSha?: string | undefined;
  registryUsername?: string | undefined;
  registryPassword?: Secret | undefined;
  s3AccessKeyId?: Secret | undefined;
  s3SecretAccessKey?: Secret | undefined;
  argocdToken?: Secret | undefined;
  chartMuseumUsername?: string | undefined;
  chartMuseumPassword?: Secret | undefined;
  cloudflareApiToken?: Secret | undefined;
  cloudflareAccountId?: Secret | undefined;
  hassBaseUrl?: Secret | undefined;
  hassToken?: Secret | undefined;
  tofuGithubToken?: Secret | undefined;
  commitBackToken?: Secret | undefined;
  birmelImage: Container;
  releasePleaseRunFn: (container: Container, command: string) => Promise<{ output: string; success: boolean }>;
  getReleasePleaseContainerFn: () => Container;
  multiplexerBuildFn: (source: Directory, s3AccessKeyId?: Secret, s3SecretAccessKey?: Secret) => Directory;
  uploadReleaseAssetsFn: (githubToken: Secret, version: string, binariesDir: Directory, filenames: string[]) => Promise<{ outputs: string[]; errors: string[] }>;
  clauderonTargets: readonly { target: string; os: string; arch: string }[];
  muxSiteDeployFn: (source: Directory, s3AccessKeyId: Secret, s3SecretAccessKey: Secret) => Promise<string>;
  resumeDeployFn: (source: Directory, s3AccessKeyId: Secret, s3SecretAccessKey: Secret) => Promise<string>;
};

/**
 * Run the release phase (main branch only).
 */
export async function runReleasePhase(
  options: ReleasePhaseOptions,
): Promise<{ outputs: string[]; errors: string[] }> {
  const outputs: string[] = [];
  const errors: string[] = [];

  // Release PR creation
  const prOutputs = await runReleasePleasePr(options);
  outputs.push(...prOutputs);

  // GitHub release creation
  const releaseResult = await runReleasePleaseGithubRelease(options);
  outputs.push(...releaseResult.outputs);

  // NPM publishing
  if (releaseResult.releaseCreated) {
    outputs.push("\n--- NPM Publishing ---");
    const npmResult = await publishNpmPackages(options.container, options.npmToken);
    outputs.push(...npmResult.outputs);
    errors.push(...npmResult.errors);
  } else {
    outputs.push("No releases created - skipping NPM publish");
    if (!releaseResult.success) {
      outputs.push("(release-please command failed - check output above for details)");
    }
  }

  // App deployments (parallel, returns appVersions from successful deploys)
  const deployResult = await runAppDeployments(options);
  outputs.push(...deployResult.outputs);
  errors.push(...deployResult.errors);

  // Homelab release (needs appVersions from deployments)
  const homelabResult = await runHomelabRelease(options, deployResult.appVersions);
  outputs.push(...homelabResult.outputs);
  errors.push(...homelabResult.errors);

  // Clauderon binary release
  const clauderonResult = await runClauderonRelease(options, releaseResult.releaseOutput);
  outputs.push(...clauderonResult.outputs);
  errors.push(...clauderonResult.errors);

  // Version commit-back — AFTER all deployments, only if no errors
  if (errors.length === 0) {
    const commitResult = await runVersionCommitBack(options, deployResult.appVersions);
    outputs.push(...commitResult);
  } else {
    outputs.push("\n--- Skipping version commit-back due to deployment errors ---");
  }

  return { outputs, errors };
}



