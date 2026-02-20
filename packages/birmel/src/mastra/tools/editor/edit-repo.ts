import {
  getErrorMessage,
  toError,
} from "@shepherdjerred/birmel/utils/errors.ts";
import { createTool } from "@shepherdjerred/birmel/voltagent/tools/create-tool.ts";
import { z } from "zod";
import type { ButtonBuilder as ButtonBuilderType } from "discord.js";

// Lazy-load discord.js components to avoid module resolution issues in test environments
async function getDiscordComponents() {
  const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } =
    await import("discord.js");
  return { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder };
}
import { getDiscordClient } from "@shepherdjerred/birmel/discord/client.ts";
import { loggers } from "@shepherdjerred/birmel/utils/logger.ts";
import { captureException } from "@shepherdjerred/birmel/observability/sentry.ts";
import { withToolSpan } from "@shepherdjerred/birmel/observability/tracing.ts";
import { getRequestContext } from "@shepherdjerred/birmel/mastra/tools/request-context.ts";
import {
  isEditorEnabled,
  getRepoConfig,
  isRepoAllowed,
  isGitHubConfigured,
  getGitHubConfig,
} from "@shepherdjerred/birmel/editor/config.ts";
import {
  getOrCreateSession,
  updateSdkSessionId,
  updateClonedRepoPath,
  storePendingChanges,
  updateMessageId,
  updateSummary,
} from "@shepherdjerred/birmel/editor/session-manager.ts";
import {
  executeEdit,
  checkClaudePrerequisites,
} from "@shepherdjerred/birmel/editor/claude-client.ts";
import {
  formatDiffForDiscord,
  formatChangeSummary,
  formatChangedFilesList,
} from "@shepherdjerred/birmel/editor/diff-formatter.ts";
import { generateBranchName } from "@shepherdjerred/birmel/editor/github-pr.ts";
import {
  hasValidAuth,
  getAuth,
} from "@shepherdjerred/birmel/editor/github-oauth.ts";
import { cloneRepo } from "@shepherdjerred/birmel/editor/repo-clone.ts";

const logger = loggers.tools.child("editor.edit-repo");

type EditResult = {
  success: boolean;
  message: string;
  data?: {
    sessionId: string;
    summary: string;
    changedFiles: string[];
    diffPreview: string;
  };
};
type RequestContext = {
  userId: string;
  guildId: string;
  sourceChannelId: string;
};

async function validateEditPreflight(
  repoName: string,
  reqCtx: RequestContext | undefined,
): Promise<EditResult | null> {
  if (!isEditorEnabled()) {
    return { success: false, message: "File editing feature is not enabled." };
  }
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
      message:
        "ANTHROPIC_API_KEY is not set. Set the environment variable or run `claude login`.",
    };
  }
  if (reqCtx == null) {
    return { success: false, message: "Could not determine request context." };
  }
  if (!isGitHubConfigured()) {
    return {
      success: false,
      message: "GitHub OAuth is not configured. Contact the bot administrator.",
    };
  }
  const hasAuth = await hasValidAuth(reqCtx.userId);
  if (!hasAuth) {
    const config = getGitHubConfig();
    const authUrl =
      config?.callbackUrl.replace("/callback", `?user=${reqCtx.userId}`) ?? "";
    return {
      success: false,
      message: `You need to connect your GitHub account before editing. Click here to authenticate: ${authUrl}`,
    };
  }
  if (!isRepoAllowed(repoName)) {
    return {
      success: false,
      message: `Repository '${repoName}' is not in the allowed list. Use list-repos to see available repositories.`,
    };
  }
  if (getRepoConfig(repoName) == null) {
    return {
      success: false,
      message: `Repository '${repoName}' configuration not found.`,
    };
  }
  return null;
}

async function ensureWorkingDirectory(
  session: Awaited<ReturnType<typeof getOrCreateSession>>,
  reqCtx: RequestContext,
  repoConfig: { repo: string; branch: string; allowedPaths?: string[] },
): Promise<
  | {
      session: Awaited<ReturnType<typeof getOrCreateSession>>;
      workingDirectory: string;
    }
  | EditResult
> {
  let workingDirectory = session.clonedRepoPath;
  if (workingDirectory == null || workingDirectory.length === 0) {
    const auth = await getAuth(reqCtx.userId);
    if (auth == null) {
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
    session = await updateClonedRepoPath(session.id, workingDirectory);
  }
  return { session, workingDirectory };
}

async function sendApprovalMessage(opts: {
  session: { id: string };
  reqCtx: RequestContext;
  repoName: string;
  result: { summary: string; changes: { filePath: string }[] };
  changeSummary: string;
  diffPreview: string;
  filesList: string;
}): Promise<void> {
  const {
    session,
    reqCtx,
    repoName,
    result,
    changeSummary,
    diffPreview,
    filesList,
  } = opts;
  const client = getDiscordClient();
  const channel = await client.channels.fetch(reqCtx.sourceChannelId);
  if (channel == null || !("send" in channel)) {
    return;
  }
  const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } =
    await getDiscordComponents();
  const embed = new EmbedBuilder()
    .setTitle("File Changes Ready for Review")
    .setDescription(result.summary)
    .addFields(
      { name: "Repository", value: repoName, inline: true },
      { name: "Changes", value: changeSummary, inline: true },
      { name: "Files", value: filesList || "None" },
      { name: "Diff Preview", value: diffPreview.slice(0, 1000) },
    )
    .setColor(5_793_266)
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

async function executeEditWorkflow(opts: {
  repoName: string;
  instruction: string;
  reqCtx: RequestContext;
  repoConfig: { repo: string; branch: string; allowedPaths?: string[] };
}): Promise<EditResult> {
  const { repoName, instruction, reqCtx, repoConfig } = opts;

  logger.info("Starting edit session", {
    repoName,
    userId: reqCtx.userId,
    channelId: reqCtx.sourceChannelId,
  });

  let session = await getOrCreateSession({
    userId: reqCtx.userId,
    guildId: reqCtx.guildId,
    channelId: reqCtx.sourceChannelId,
    repoName,
  });

  const dirResult = await ensureWorkingDirectory(session, reqCtx, repoConfig);
  if ("success" in dirResult) {
    return dirResult;
  }
  session = dirResult.session;
  const { workingDirectory } = dirResult;

  const result = await executeEdit({
    prompt: instruction,
    workingDirectory,
    ...(session.sdkSessionId != null &&
      session.sdkSessionId.length > 0 && {
        resumeSessionId: session.sdkSessionId,
      }),
    allowedPaths: repoConfig.allowedPaths,
  });

  if (result.sdkSessionId != null && result.sdkSessionId.length > 0) {
    await updateSdkSessionId(session.id, result.sdkSessionId);
  }
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

  const branchName = generateBranchName(result.summary);
  await storePendingChanges(
    session.id,
    result.changes,
    branchName,
    repoConfig.branch,
  );

  const diffPreview = formatDiffForDiscord(result.changes);
  const changeSummary = formatChangeSummary(result.changes);
  const filesList = formatChangedFilesList(result.changes);

  await sendApprovalMessage({
    session,
    reqCtx,
    repoName,
    result,
    changeSummary,
    diffPreview,
    filesList,
  });

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
}

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
        const preflightError = await validateEditPreflight(repoName, reqCtx);
        if (preflightError != null) {
          return preflightError;
        }

        // reqCtx is guaranteed non-null after preflight validation
        if (reqCtx == null) {
          return {
            success: false,
            message: "Could not determine request context.",
          };
        }

        const repoConfig = getRepoConfig(repoName);
        if (repoConfig == null) {
          return {
            success: false,
            message: `Repository '${repoName}' configuration not found.`,
          };
        }

        return await executeEditWorkflow({
          repoName,
          instruction,
          reqCtx,
          repoConfig,
        });
      } catch (error) {
        logger.error("Failed to execute edit", error);
        captureException(toError(error), { operation: "tool.edit-repo" });
        return {
          success: false,
          message: `Failed to execute edit: ${getErrorMessage(error)}`,
        };
      }
    });
  },
});
