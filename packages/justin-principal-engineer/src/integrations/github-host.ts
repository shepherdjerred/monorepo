import type { Config } from "#src/domain/schemas.ts";
import { createGitHubAuth } from "#src/integrations/github-app.ts";
import { GitHubClient } from "#src/integrations/github.ts";
import { readOpReference } from "#src/integrations/secrets.ts";
import type { RuntimePaths } from "#src/runtime/paths.ts";
import type { CommandRunner } from "#src/runtime/process.ts";

export function githubHost(
  config: Config,
  paths: RuntimePaths,
  run: CommandRunner,
) {
  return async <T>(
    work: (
      github: GitHubClient,
      env: Readonly<Record<string, string>>,
    ) => Promise<T>,
  ): Promise<T> => {
    const auth = await createGitHubAuth(config, paths, run);
    try {
      const env = {
        ...auth.env,
        WOODPECKER_TOKEN: await readOpReference(
          config.woodpecker.apiToken,
          run,
        ),
        WOODPECKER_URL: config.woodpecker.baseUrl,
        WOODPECKER_REPO_ID: String(config.woodpecker.repoId),
      };
      const github = new GitHubClient(
        config.repository.slug,
        {
          approver: {
            login: config.github.approverLogin,
            id: config.github.approverId,
          },
          expectedBotLogin: config.github.botLogin,
        },
        run,
        env,
      );
      return await work(github, env);
    } finally {
      await auth.cleanup();
    }
  };
}
