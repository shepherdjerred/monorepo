import { createTool } from "../../../voltagent/tools/create-tool.js";
import { z } from "zod";
import type { ButtonBuilder as ButtonBuilderType } from "discord.js";

// Lazy-load discord.js components to avoid module resolution issues in test environments
async function getDiscordComponents() {
  const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = await import("discord.js");
  return { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder };
}
import { getDiscordClient } from "../../../discord/index.js";
import { loggers } from "../../../utils/logger.js";
import { withToolSpan, captureException } from "../../../observability/index.js";
import { getRequestContext } from "../request-context.js";
import {
  isEditorEnabled,
  getRepoConfig,
  isRepoAllowed,
  getOrCreateSession,
  updateSdkSessionId,
  updateClonedRepoPath,
  storePendingChanges,
  updateMessageId,
  updateSummary,
  executeEdit,
  formatDiffForDiscord,
  formatChangeSummary,
  formatChangedFilesList,
  generateBranchName,
  checkClaudePrerequisites,
  hasValidAuth,
  getAuth,
  isGitHubConfigured,
  getGitHubConfig,
  cloneRepo,
} from "../../../editor/index.js";

const logger = loggers.tools.child("editor.edit-repo");

export const editRepoTool = createTool({
  id: "edit-repo",
  description: `Edit files in an allowed repository using AI assistance.
    Provide the repo name and a natural language instruction describing what changes to make.
    Returns a diff of changes for user approval.
    Use this when the user wants to edit code, update configs, or modify files in a repository.`,
  inputSchema: z.object({
    repoName: z.string().describe("Repository name (e.g., 'scout-for-lol')"),
    instruction: z
      .string()
      .describe("Natural language instruction describing what changes to make"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z
      .object({
        sessionId: z.string(),
        summary: z.string(),
        changedFiles: z.array(z.string()),
        diffPreview: z.string(),
      })
      .optional(),
  }),
  execute: async (ctx) => {
    const { repoName, instruction } = ctx;
    const reqCtx = getRequestContext();

    return withToolSpan("edit-repo", reqCtx?.guildId, async () => {
      try {
        // Check if editor is enabled
        if (!isEditorEnabled()) {
          return {
            success: false,
            message: "File editing feature is not enabled.",
          };
        }

        // Check Claude CLI prerequisites
        const claudeCheck = await checkClaudePrerequisites();
        if (!claudeCheck.installed) {
          return {
            success: false,
            message: "Claude Code CLI is not installed. Run `claude install` first.",
          };
        }
        if (!claudeCheck.hasApiKey) {
          return {
            success: false,
            message: "ANTHROPIC_API_KEY is not set. Set the environment variable or run `claude login`.",
          };
        }

        // Get request context
        if (!reqCtx) {
          return {
            success: false,
            message: "Could not determine request context.",
          };
        }

        // Check GitHub OAuth is configured
        if (!isGitHubConfigured()) {
          return {
            success: false,
            message: "GitHub OAuth is not configured. Contact the bot administrator.",
          };
        }

        // Check user has GitHub auth before allowing edits
        const hasAuth = await hasValidAuth(reqCtx.userId);
        if (!hasAuth) {
          const config = getGitHubConfig();
          // Derive OAuth start URL from callback URL (remove /callback suffix)
          const authUrl = config?.callbackUrl.replace("/callback", `?user=${reqCtx.userId}`) ?? "";
          return {
            success: false,
            message: `You need to connect your GitHub account before editing. Click here to authenticate: ${authUrl}`,
          };
        }

        // Validate repo is in allowlist
        if (!isRepoAllowed(repoName)) {
          return {
            success: false,
            message: `Repository '${repoName}' is not in the allowed list. Use list-repos to see available repositories.`,
          };
        }

        const repoConfig = getRepoConfig(repoName);
        if (!repoConfig) {
          return {
            success: false,
            message: `Repository '${repoName}' configuration not found.`,
          };
        }

        logger.info("Starting edit session", {
          repoName,
          userId: reqCtx.userId,
          channelId: reqCtx.sourceChannelId,
        });

        // Get or create session
        let session = await getOrCreateSession({
          userId: reqCtx.userId,
          guildId: reqCtx.guildId,
          channelId: reqCtx.sourceChannelId,
          repoName,
        });

        // Clone repo on first edit if not already cloned
        let workingDirectory = session.clonedRepoPath;
        if (!workingDirectory) {
          const auth = await getAuth(reqCtx.userId);
          if (!auth) {
            return {
              success: false,
              message: "GitHub authentication required to clone repository.",
            };
          }

          logger.info("Cloning repository for first edit", {
            repo: repoConfig.repo,
            sessionId: session.id,
          });

          workingDirectory = await cloneRepo({
            repo: repoConfig.repo,
            branch: repoConfig.branch,
            token: auth.accessToken,
            sessionId: session.id,
          });

          // Update session with cloned repo path
          session = await updateClonedRepoPath(session.id, workingDirectory);
        }

        // Execute Claude edit
        const result = await executeEdit({
          prompt: instruction,
          workingDirectory,
          ...(session.sdkSessionId && { resumeSessionId: session.sdkSessionId }),
          allowedPaths: repoConfig.allowedPaths,
        });

        // Update session with SDK session ID
        if (result.sdkSessionId) {
          await updateSdkSessionId(session.id, result.sdkSessionId);
        }

        // Update summary
        await updateSummary(session.id, result.summary);

        if (result.changes.length === 0) {
          return {
            success: true,
            message: result.summary || "No changes were made.",
            data: {
              sessionId: session.id,
              summary: result.summary,
              changedFiles: [],
              diffPreview: "No changes made.",
            },
          };
        }

        // Generate branch name
        const branchName = generateBranchName(result.summary);

        // Store pending changes
        await storePendingChanges(
          session.id,
          result.changes,
          branchName,
          repoConfig.branch,
        );

        // Format diff for Discord
        const diffPreview = formatDiffForDiscord(result.changes);
        const changeSummary = formatChangeSummary(result.changes);
        const filesList = formatChangedFilesList(result.changes);

        // Send approval message with buttons
        const client = getDiscordClient();
        const channel = await client.channels.fetch(reqCtx.sourceChannelId);

        if (channel && "send" in channel) {
          const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = await getDiscordComponents();
          const embed = new EmbedBuilder()
            .setTitle("File Changes Ready for Review")
            .setDescription(result.summary)
            .addFields(
              { name: "Repository", value: repoName, inline: true },
              { name: "Changes", value: changeSummary, inline: true },
              { name: "Files", value: filesList || "None" },
              { name: "Diff Preview", value: diffPreview.slice(0, 1000) },
            )
            .setColor(0x5865f2)
            .setFooter({ text: `Session: ${session.id.slice(0, 8)}` });

          const buttons = new ActionRowBuilder<ButtonBuilderType>().addComponents(
            new ButtonBuilder()
              .setCustomId(`editor:approve:${session.id}`)
              .setLabel("Approve & Create PR")
              .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
              .setCustomId(`editor:continue:${session.id}`)
              .setLabel("Continue Editing")
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId(`editor:reject:${session.id}`)
              .setLabel("Reject")
              .setStyle(ButtonStyle.Danger),
          );

          const message = await channel.send({
            embeds: [embed],
            components: [buttons],
          });

          await updateMessageId(session.id, message.id);
        }

        return {
          success: true,
          message: `Changes ready for review. ${changeSummary}`,
          data: {
            sessionId: session.id,
            summary: result.summary,
            changedFiles: result.changes.map((c) => c.filePath),
            diffPreview,
          },
        };
      } catch (error) {
        logger.error("Failed to execute edit", error);
        captureException(error as Error, { operation: "tool.edit-repo" });
        return {
          success: false,
          message: `Failed to execute edit: ${(error as Error).message}`,
        };
      }
    });
  },
});
