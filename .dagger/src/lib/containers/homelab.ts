import type { Secret } from "@dagger.io/dagger";
import { getGitHubContainer } from "./github.ts";

export type CommitVersionsBackOptions = {
  /** GitHub token for authentication */
  token: Secret;
  /** Map of version keys to version values (e.g. "shepherdjerred/birmel" -> "1.0.123") */
  versions: Record<string, string>;
};

/**
 * Commits updated versions back to the monorepo's versions.ts file on main.
 *
 * Uses sed to update each version key in packages/homelab/src/cdk8s/src/versions.ts,
 * then commits and pushes directly to main. Uses [skip ci] in the commit message
 * to prevent cascading CI runs.
 *
 * @returns stdout from the git operations (either "NO_CHANGES" or commit info)
 */
export async function commitVersionsBack(
  options: CommitVersionsBackOptions,
): Promise<string> {
  let container = getGitHubContainer()
    .withSecretVariable("GH_TOKEN", options.token)
    .withEnvVariable("CACHE_BUST", Date.now().toString())
    .withExec(["gh", "auth", "setup-git"])
    .withExec([
      "git",
      "clone",
      "--branch=main",
      "--depth=1",
      "https://github.com/shepherdjerred/monorepo",
      ".",
    ]);

  for (const [key, ver] of Object.entries(options.versions)) {
    const escaped = key.replaceAll("/", String.raw`\/`);
    container = container.withExec([
      "sh",
      "-c",
      `sed -i 's/"${escaped}": "[^"]*"/"${escaped}": "${ver}"/g' packages/homelab/src/cdk8s/src/versions.ts`,
    ]);
  }

  return container
    .withExec([
      "sh",
      "-c",
      'git diff --quiet && echo "NO_CHANGES" || ' +
        "(git add packages/homelab/src/cdk8s/src/versions.ts && " +
        'git commit -m "chore: update deployed image versions [skip ci]" && ' +
        "(git push origin main || (git pull --rebase origin main && git push origin main)))",
    ])
    .stdout();
}
