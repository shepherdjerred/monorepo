import type { Secret, Container } from "@dagger.io/dagger";
import {
  publishBirmelImageWithContainer,
} from "./birmel.ts";
import { deployWebringDocs } from "./webring.ts";
import { deployStarlightKarmaBot } from "./starlight-karma-bot.ts";
import { deployBetterSkillCapped } from "./better-skill-capped.ts";
import { deploySjerRed } from "./sjer-red.ts";
import { deployDiscordPlaysPokemon } from "./discord-plays-pokemon.ts";
import { deployScoutForLol } from "./scout-for-lol.ts";
import { ciHomelab } from "./homelab-index.ts";
import { Stage as HomelabStage } from "./lib-types.ts";
import { commitVersionsBack } from "./lib-homelab.ts";
import { runNamedParallel } from "./lib-parallel.ts";
import type { ReleasePhaseOptions } from "./index-ci-helpers.ts";

const PACKAGES = [
  "bun-decompile",
  "astro-opengraph-images",
  "webring",
] as const;

const REPO_URL = "shepherdjerred/monorepo";

export async function runReleasePleasePr(
  options: ReleasePhaseOptions,
): Promise<string[]> {
  const outputs: string[] = [];
  const prContainer = options.getReleasePleaseContainerFn().withSecretVariable(
    "GITHUB_TOKEN",
    options.githubToken,
  );

  const prResult = await options.releasePleaseRunFn(
    prContainer,
    `git clone https://x-access-token:$GITHUB_TOKEN@github.com/${REPO_URL}.git . && release-please release-pr --token=$GITHUB_TOKEN --repo-url=${REPO_URL} --target-branch=main`,
  );

  outputs.push(`Release PR (success=${String(prResult.success)}):`);
  outputs.push(prResult.output);
  return outputs;
}

export async function runReleasePleaseGithubRelease(
  options: ReleasePhaseOptions,
): Promise<{ outputs: string[]; releaseCreated: boolean; success: boolean; releaseOutput: string }> {
  const outputs: string[] = [];
  const releaseContainer = options.getReleasePleaseContainerFn().withSecretVariable(
    "GITHUB_TOKEN",
    options.githubToken,
  );

  const result = await options.releasePleaseRunFn(
    releaseContainer,
    `git clone https://x-access-token:$GITHUB_TOKEN@github.com/${REPO_URL}.git . && release-please github-release --token=$GITHUB_TOKEN --repo-url=${REPO_URL} --target-branch=main`,
  );

  outputs.push(`GitHub Release (success=${String(result.success)}):`);
  outputs.push(result.output);

  const releaseCreated =
    result.success &&
    (result.output.includes("github.com") ||
      result.output.includes("Created release") ||
      result.output.includes("created release"));

  return { outputs, releaseCreated, success: result.success, releaseOutput: result.output };
}

export async function publishNpmPackages(
  container: Container,
  npmToken: Secret,
): Promise<{ outputs: string[]; errors: string[] }> {
  const npmPackages = [
    ...PACKAGES.map((pkg) => ({
      name: `@shepherdjerred/${pkg}`,
      path: `packages/${pkg}`,
    })),
    {
      name: "@shepherdjerred/helm-types",
      path: "packages/homelab/src/helm-types",
    },
  ];

  const results = await runNamedParallel(npmPackages.map(pkg => ({
    name: pkg.name,
    operation: async () => {
      await container
        .withWorkdir(`/workspace/${pkg.path}`)
        .withSecretVariable("NPM_TOKEN", npmToken)
        .withExec([
          "sh",
          "-c",
          'echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > ~/.npmrc',
        ])
        .withExec([
          "bun",
          "publish",
          "--access",
          "public",
          "--tag",
          "latest",
          "--registry",
          "https://registry.npmjs.org",
        ])
        .stdout();
      return `Published ${pkg.name}`;
    },
  })));

  const outputs: string[] = [];
  const errors: string[] = [];
  for (const result of results) {
    if (result.success) {
      outputs.push(String(result.value));
    } else {
      const msg = result.error instanceof Error ? result.error.message : String(result.error);
      outputs.push(`✗ Failed to publish ${result.name}: ${msg}`);
      errors.push(`Failed to publish ${result.name}: ${msg}`);
    }
  }

  return { outputs, errors };
}

type DeployTask = {
  name: string;
  versionKey?: string;
  deploy: () => Promise<string>;
};

async function withDeployRetry(
  name: string,
  fn: () => Promise<string>,
  maxRetries = 2,
): Promise<string> {
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

export async function runAppDeployments(
  options: ReleasePhaseOptions,
): Promise<{ outputs: string[]; errors: string[]; appVersions: Record<string, string> }> {
  const { source, version, gitSha, registryUsername, registryPassword, s3AccessKeyId, s3SecretAccessKey, birmelImage } = options;

  const tasks: DeployTask[] = [];

  // Birmel publish
  if (version !== undefined && gitSha !== undefined && registryUsername !== undefined && registryPassword !== undefined) {
    tasks.push({
      name: "Birmel publish",
      versionKey: "shepherdjerred/birmel",
      deploy: async () => {
        const refs = await publishBirmelImageWithContainer({
          image: birmelImage, version, gitSha,
          registryAuth: { username: registryUsername, password: registryPassword },
        });
        return `Published:\n${refs.join("\n")}`;
      },
    });
  }

  // Docs/resume/S3 deployments
  if (s3AccessKeyId !== undefined && s3SecretAccessKey !== undefined) {
    tasks.push(
      { name: "Clauderon docs", deploy: () => options.muxSiteDeployFn(source, s3AccessKeyId, s3SecretAccessKey) },
      { name: "Resume", deploy: () => options.resumeDeployFn(source, s3AccessKeyId, s3SecretAccessKey) },
      { name: "sjer.red", deploy: () => deploySjerRed(source, s3AccessKeyId, s3SecretAccessKey) },
      { name: "Webring docs", deploy: () => deployWebringDocs(source, s3AccessKeyId, s3SecretAccessKey) },
    );
  }

  // GHCR deployments
  if (version !== undefined && gitSha !== undefined && registryUsername !== undefined && registryPassword !== undefined) {
    tasks.push({
      name: "Starlight Karma Bot",
      versionKey: "shepherdjerred/starlight-karma-bot/beta",
      deploy: () => deployStarlightKarmaBot({
        source, version, gitSha,
        ghcrUsername: registryUsername, ghcrPassword: registryPassword,
      }),
    });

    if (s3AccessKeyId !== undefined && s3SecretAccessKey !== undefined) {
      tasks.push(
        {
          name: "Better Skill Capped",
          versionKey: "shepherdjerred/better-skill-capped-fetcher",
          deploy: () => deployBetterSkillCapped({
            source, version, s3AccessKeyId, s3SecretAccessKey,
            ghcrUsername: registryUsername, ghcrPassword: registryPassword,
          }),
        },
        {
          name: "Discord Plays Pokemon",
          versionKey: "shepherdjerred/discord-plays-pokemon",
          deploy: () => deployDiscordPlaysPokemon({
            source, version, gitSha,
            ghcrUsername: registryUsername, ghcrPassword: registryPassword,
            s3AccessKeyId, s3SecretAccessKey,
          }),
        },
        {
          name: "Scout for LoL",
          versionKey: "shepherdjerred/scout-for-lol/beta",
          deploy: () => deployScoutForLol({
            source, version, gitSha,
            ghcrUsername: registryUsername, ghcrPassword: registryPassword,
            ghToken: options.githubToken, s3AccessKeyId, s3SecretAccessKey,
          }),
        },
      );
    }
  }

  // Run all deployment tasks in parallel, with per-task GraphQL error retry
  const results = await runNamedParallel(tasks.map(t => ({
    name: t.name,
    operation: () => withDeployRetry(t.name, t.deploy),
  })));

  // Collect results and build appVersions from SUCCESSFUL deployments only
  const outputs: string[] = [];
  const errors: string[] = [];
  const appVersions: Record<string, string> = {};

  for (const result of results) {
    const task = tasks.find(t => t.name === result.name);
    if (task === undefined) { continue; }
    if (result.success) {
      outputs.push(`✓ ${task.name}: ${String(result.value)}`);
      if (task.versionKey !== undefined && version !== undefined) {
        appVersions[task.versionKey] = version;
      }
    } else {
      const { error } = result;
      const msg = error instanceof Error ? error.message : String(error);
      outputs.push(`✗ ${task.name}: ${msg}`);
      errors.push(`${task.name}: ${msg}`);
    }
  }

  return { outputs, errors, appVersions };
}

export async function runHomelabRelease(
  options: ReleasePhaseOptions,
  appVersions: Record<string, string>,
): Promise<{ outputs: string[]; errors: string[] }> {
  const outputs: string[] = [];
  const errors: string[] = [];
  const { source, argocdToken, chartMuseumUsername, chartMuseumPassword, cloudflareApiToken, cloudflareAccountId, registryPassword, registryUsername, s3AccessKeyId, s3SecretAccessKey, hassBaseUrl, hassToken, tofuGithubToken, version } = options;

  if (
    argocdToken === undefined ||
    chartMuseumUsername === undefined ||
    chartMuseumPassword === undefined ||
    cloudflareApiToken === undefined ||
    cloudflareAccountId === undefined ||
    registryPassword === undefined ||
    s3AccessKeyId === undefined ||
    s3SecretAccessKey === undefined
  ) {
    return { outputs, errors };
  }

  outputs.push("\n--- Homelab Release ---");
  try {
    const homelabSecrets = {
      argocdToken,
      ghcrUsername: registryUsername ?? "",
      ghcrPassword: registryPassword,
      chartVersion: version ?? "dev",
      chartMuseumUsername,
      chartMuseumPassword,
      cloudflareApiToken,
      cloudflareAccountId,
      awsAccessKeyId: s3AccessKeyId,
      awsSecretAccessKey: s3SecretAccessKey,
      ...(hassBaseUrl === undefined ? {} : { hassBaseUrl }),
      ...(hassToken === undefined ? {} : { hassToken }),
      ...(tofuGithubToken === undefined ? {} : { tofuGithubToken }),
      appVersions,
    };
    outputs.push(await ciHomelab(source, HomelabStage.Prod, homelabSecrets));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    outputs.push(`Fail homelab release: ${msg}`);
    errors.push(`homelab release: ${msg}`);
  }

  return { outputs, errors };
}

export async function runVersionCommitBack(
  options: ReleasePhaseOptions,
  appVersions: Record<string, string>,
): Promise<string[]> {
  const outputs: string[] = [];
  const { commitBackToken, version } = options;

  if (commitBackToken === undefined || version === undefined) {
    return outputs;
  }

  outputs.push("\n--- Version Commit-Back ---");
  try {
    const allVersions: Record<string, string> = {
      "shepherdjerred/homelab": version,
      "shepherdjerred/dependency-summary": version,
      "shepherdjerred/dns-audit": version,
      "shepherdjerred/caddy-s3proxy": version,
      ...appVersions,
    };
    const result = await commitVersionsBack({
      token: commitBackToken,
      versions: allVersions,
    });
    outputs.push(`Versions committed to git: ${result.trim()}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    outputs.push(`Version commit-back failed (non-fatal): ${msg}`);
  }

  return outputs;
}

export async function runClauderonRelease(
  options: ReleasePhaseOptions,
  releaseOutput: string,
): Promise<{ outputs: string[]; errors: string[] }> {
  const outputs: string[] = [];
  const errors: string[] = [];
  const { source, githubToken, s3AccessKeyId, s3SecretAccessKey } = options;

  const clauderonVersionMatch = /clauderon-v([\d.]+)/.exec(releaseOutput);
  const clauderonVersion = clauderonVersionMatch?.[1];

  if (clauderonVersion === undefined) {
    outputs.push("\nNo clauderon release detected - skipping binary upload");
    return { outputs, errors };
  }

  outputs.push("\n--- Multiplexer Release ---");
  outputs.push(`Detected clauderon release: v${clauderonVersion}`);

  try {
    const binaries = options.multiplexerBuildFn(source, s3AccessKeyId, s3SecretAccessKey);

    const linuxTargets = options.clauderonTargets.filter((t) => t.os === "linux");
    const filenames = linuxTargets.map(({ os, arch }) => `clauderon-${os}-${arch}`);

    for (const filename of filenames) {
      outputs.push(`Built ${filename}`);
    }

    const uploadResults = await options.uploadReleaseAssetsFn(
      githubToken,
      clauderonVersion,
      binaries,
      filenames,
    );
    outputs.push(...uploadResults.outputs);
    errors.push(...uploadResults.errors);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const failureMsg = `Failed to build/upload clauderon binaries: ${errorMessage}`;
    outputs.push(`Fail ${failureMsg}`);
    errors.push(failureMsg);
  }

  return { outputs, errors };
}
