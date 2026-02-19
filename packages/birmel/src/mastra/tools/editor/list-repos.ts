import { createTool } from "@shepherdjerred/birmel/voltagent/tools/create-tool.ts";
import { z } from "zod";
import { loggers } from "@shepherdjerred/birmel/utils/logger.ts";
import { withToolSpan } from "@shepherdjerred/birmel/observability/tracing.ts";
import { getRequestContext } from "@shepherdjerred/birmel/mastra/tools/request-context.ts";
import { isEditorEnabled, getAllowedRepos } from "@shepherdjerred/birmel/editor/config.ts";

const logger = loggers.tools.child("editor.list-repos");

export const listReposTool = createTool({
  id: "list-repos",
  description: `List all repositories available for editing.
    Shows repository names, allowed paths, and default branches.
    Use this when the user asks what repos they can edit or needs to know available repositories.`,
  inputSchema: z.object({}),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z
      .object({
        repos: z.array(
          z.object({
            name: z.string(),
            branch: z.string(),
            allowedPaths: z.array(z.string()),
          }),
        ),
      })
      .optional(),
  }),
  execute: async () => {
    const reqCtx = getRequestContext();

    return withToolSpan("list-repos", reqCtx?.guildId, async () => {
      // Check if editor is enabled
      if (!isEditorEnabled()) {
        return await Promise.resolve({
          success: false,
          message: "File editing feature is not enabled.",
        });
      }

      const repos = getAllowedRepos();

      if (repos.length === 0) {
        return await Promise.resolve({
          success: true,
          message: "No repositories are configured for editing.",
          data: { repos: [] },
        });
      }

      logger.debug("Listing available repos", { count: repos.length });

      const repoList = repos.map((repo) => ({
        name: repo.name,
        branch: repo.branch,
        allowedPaths: repo.allowedPaths,
      }));

      const repoNames = repoList.map((r) => r.name).join(", ");

      return await Promise.resolve({
        success: true,
        message: `Available repositories: ${repoNames}`,
        data: { repos: repoList },
      });
    });
  },
});
