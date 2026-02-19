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
  "packages/better-skill-capped",
  "packages/sjer.red",
  "packages/webring",
  "packages/starlight-karma-bot",
  "packages/homelab",
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
  });
}

/**
 * Set up Prisma client for Birmel CI.
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
    .withExec(["/workspace/node_modules/.bin/prisma", "generate"])
    .withExec([
      "/workspace/node_modules/.bin/prisma",
      "db",
      "push",
      "--accept-data-loss",
    ])
    .withWorkdir("/workspace");
  await c.sync();
  outputs.push("✓ Prisma setup");

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

  await rustContainer.sync();
  outputs.push("✓ TypeScript types generated");

  const generatedTypes = rustContainer.directory(
    "/workspace/web/shared/src/generated",
  );
  let c = container.withDirectory(
    "/workspace/packages/clauderon/web/shared/src/generated",
    generatedTypes,
  );
  await c.sync();
  outputs.push("✓ Types copied to workspace");

  c = c
    .withWorkdir("/workspace/packages/clauderon/web/shared")
    .withExec(["bun", "run", "build"])
    .withWorkdir("/workspace/packages/clauderon/web/client")
    .withExec(["bun", "run", "build"])
    .withWorkdir("/workspace/packages/clauderon/web/frontend")
    .withExec(["bun", "run", "build"])
    .withWorkdir("/workspace");
  await c.sync();
  outputs.push("✓ Web packages built");

  const frontendDist = c.directory(
    "/workspace/packages/clauderon/web/frontend/dist",
  );

  return { container: c, frontendDist, outputs };
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

  const results = await Promise.allSettled([
    checkAstroOpengraphImages(source),
    checkWebring(source),
    checkStarlightKarmaBot(source),
    checkBetterSkillCapped(source),
    checkSjerRed(source),
    checkDiscordPlaysPokemon(source),
    checkScoutForLol(source),
    checkCastleCasters(source),
    checkHomelab(source, hassBaseUrl, hassToken),
  ]);

  for (const result of results) {
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
 * Options for the release phase
 */
export type ReleasePhaseOptions = {
  source: Directory;
  container: Container;
  githubToken: Secret;
  npmToken: Secret;
  version?: string;
  gitSha?: string;
  registryUsername?: string;
  registryPassword?: Secret;
  s3AccessKeyId?: Secret;
  s3SecretAccessKey?: Secret;
  argocdToken?: Secret;
  chartMuseumUsername?: string;
  chartMuseumPassword?: Secret;
  cloudflareApiToken?: Secret;
  cloudflareAccountId?: Secret;
  hassBaseUrl?: Secret;
  hassToken?: Secret;
  tofuGithubToken?: Secret;
  commitBackToken?: Secret;
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



