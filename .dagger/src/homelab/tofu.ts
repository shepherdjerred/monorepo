import type { Container, Directory, Secret } from "@dagger.io/dagger";
import { dag } from "@dagger.io/dagger";
import versions from "./versions.ts";
import { execWithOutput } from "./errors.ts";

const TOFU_VERSION = "1.9.0";
const TOFU_DIRS = ["cloudflare", "github", "seaweedfs"] as const;

/**
 * Returns a container with OpenTofu installed on Alpine.
 */
function getTofuContainer(): Container {
  return dag
    .container()
    .from(`alpine:${versions.alpine}`)
    .withExec(["apk", "add", "--no-cache", "curl", "unzip", "aws-cli", "gnupg"])
    .withExec([
      "sh",
      "-c",
      `curl -fsSL https://get.opentofu.org/install-opentofu.sh | sh -s -- --install-method apk --opentofu-version ${TOFU_VERSION}`,
    ]);
}

/**
 * Runs `tofu init && tofu plan -detailed-exitcode` for a single directory.
 * Returns plan output with drift indicator.
 * Exit code 0 = no changes, 1 = error, 2 = drift detected.
 */
export async function planDir(
  source: Directory,
  dir: string,
  cloudflareApiToken: Secret,
  cloudflareAccountId: Secret,
  awsAccessKeyId: Secret,
  awsSecretAccessKey: Secret,
  githubToken?: Secret,
): Promise<{ dir: string; hasDrift: boolean; output: string }> {
  let container = getTofuContainer()
    .withMountedDirectory("/workspace", source.directory(`src/tofu/${dir}`))
    .withWorkdir("/workspace")
    .withSecretVariable("AWS_ACCESS_KEY_ID", awsAccessKeyId)
    .withSecretVariable("AWS_SECRET_ACCESS_KEY", awsSecretAccessKey)
    .withSecretVariable("CLOUDFLARE_API_TOKEN", cloudflareApiToken)
    .withSecretVariable("TF_VAR_cloudflare_account_id", cloudflareAccountId);

  if (githubToken) {
    container = container.withSecretVariable("GITHUB_TOKEN", githubToken);
  }

  container = container.withExec(["tofu", "init"]);

  // Run plan with -detailed-exitcode: 0=no changes, 1=error, 2=drift
  const result = await execWithOutput(container, [
    "tofu",
    "plan",
    "-detailed-exitcode",
    "-no-color",
  ]);

  if (result.exitCode === 1) {
    const output =
      [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n") ||
      "No output";
    throw new Error(`tofu plan failed for ${dir}:\n${output}`);
  }

  const output = [result.stdout.trim(), result.stderr.trim()]
    .filter(Boolean)
    .join("\n");
  return { dir, hasDrift: result.exitCode === 2, output };
}

/**
 * Runs tofu plan for all directories in parallel.
 * Returns a summary string. Throws if any directory fails.
 */
export async function planAll(
  source: Directory,
  cloudflareApiToken: Secret,
  cloudflareAccountId: Secret,
  awsAccessKeyId: Secret,
  awsSecretAccessKey: Secret,
  githubToken?: Secret,
): Promise<string> {
  const results = await Promise.allSettled(
    TOFU_DIRS.map((dir) =>
      planDir(
        source,
        dir,
        cloudflareApiToken,
        cloudflareAccountId,
        awsAccessKeyId,
        awsSecretAccessKey,
        githubToken,
      ),
    ),
  );

  const summary = results
    .map((result, i) => {
      const dir = TOFU_DIRS[i] ?? "unknown";
      if (result.status === "fulfilled") {
        const { hasDrift, output } = result.value;
        return hasDrift
          ? `${dir}: DRIFT DETECTED\n${output}`
          : `${dir}: No changes`;
      }
      return `${dir}: FAILED\n${String(result.reason)}`;
    })
    .join("\n\n");

  const anyFailed = results.some((r) => r.status === "rejected");
  if (anyFailed) {
    throw new Error(`OpenTofu Plan Results:\n${summary}`);
  }

  return `OpenTofu Plan Results:\n${summary}`;
}
