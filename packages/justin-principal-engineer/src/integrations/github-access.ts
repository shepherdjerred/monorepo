import { z } from "zod";
import type { Config } from "#src/domain/schemas.ts";
import { createGitHubAuth } from "#src/integrations/github-app.ts";
import type { RuntimePaths } from "#src/runtime/paths.ts";
import { requireSuccess, type CommandRunner } from "#src/runtime/process.ts";

export async function checkBranchProtectionAccess(
  repository: Config["repository"],
  token: string,
  request: typeof fetch = fetch,
): Promise<void> {
  const response = await request(
    `https://api.github.com/repos/${repository.slug}/branches/${encodeURIComponent(repository.baseBranch)}/protection`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (response.ok) return;
  if (response.status === 404) {
    const body = z.object({ message: z.string() }).parse(await response.json());
    if (body.message === "Branch not protected") return;
  }
  const remediation =
    response.status === 403
      ? "; grant the GitHub App repository Administration read access and approve the installation permission update"
      : "";
  throw new Error(
    `GitHub App branch protection access failed (HTTP ${String(response.status)})${remediation}`,
  );
}

export async function checkGitHubAccess(input: {
  config: Config;
  paths: RuntimePaths;
  run: CommandRunner;
}): Promise<void> {
  const github = await createGitHubAuth(input.config, input.paths, input.run);
  try {
    requireSuccess(
      "GitHub App repository access",
      await input.run(
        ["gh", "api", `repos/${input.config.repository.slug}`, "--silent"],
        { env: github.env },
      ),
    );
    const token = github.env["GH_TOKEN"];
    if (token === undefined) throw new Error("GitHub App token is missing");
    await checkBranchProtectionAccess(input.config.repository, token);
  } finally {
    await github.cleanup();
  }
}
