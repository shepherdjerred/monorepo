import type { Client, ButtonInteraction, EmbedBuilder as EmbedBuilderType } from "discord.js";

// Lazy-load EmbedBuilder to avoid module resolution issues in test environments
async function getEmbedBuilder(): Promise<typeof EmbedBuilderType> {
  const { EmbedBuilder } = await import("discord.js");
  return EmbedBuilder;
}
import { loggers } from "../../utils/index.js";
import { captureException } from "../../observability/index.js";
import {
  getSession,
  getPendingChanges,
  updateSessionState,
  cleanupSessionClone,
  SessionState,
  hasValidAuth,
  getAuthorizationUrl,
  createPullRequest,
  generatePRTitle,
  generatePRBody,
  updatePrUrl,
  extendSession,
} from "../../editor/index.js";

const logger = loggers.discord.child("interaction-create");

export function setupInteractionHandler(client: Client): void {
  client.on("interactionCreate", (interaction) => {
    void (async () => {
    if (!interaction.isButton()) return;

    // Only handle editor-related buttons
    if (!interaction.customId.startsWith("editor:")) return;

    try {
      await handleEditorButton(interaction);
    } catch (error) {
      logger.error("Failed to handle editor interaction", error);
      captureException(error as Error, {
        operation: "interaction.editor",
        extra: { customId: interaction.customId },
      });

      // Try to respond with error
      try {
        const errorMessage = `An error occurred: ${(error as Error).message}`;
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: errorMessage, flags: 64 });
        } else {
          await interaction.reply({ content: errorMessage, flags: 64 });
        }
      } catch {
        // Ignore if we can't respond
      }
    }
    })();
  });

  logger.info("Interaction handler registered");
}

async function handleEditorButton(interaction: ButtonInteraction): Promise<void> {
  const [, action, sessionId] = interaction.customId.split(":");

  if (!action || !sessionId) {
    await interaction.reply({
      content: "Invalid button interaction.",
      flags: 64,
    });
    return;
  }

  // Get session
  const session = await getSession(sessionId);
  if (!session) {
    await interaction.reply({
      content: "Session not found. It may have expired.",
      flags: 64,
    });
    return;
  }

  // Verify user owns the session
  if (session.userId !== interaction.user.id) {
    await interaction.reply({
      content: "You don't have permission to interact with this session.",
      flags: 64,
    });
    return;
  }

  logger.info("Handling editor button", {
    action,
    sessionId,
    userId: interaction.user.id,
  });

  switch (action) {
    case "approve":
      await handleApprove(interaction, sessionId);
      break;
    case "reject":
      await handleReject(interaction, sessionId);
      break;
    case "continue":
      await handleContinue(interaction, sessionId);
      break;
    default:
      await interaction.reply({
        content: `Unknown action: ${action}`,
        flags: 64,
      });
  }
}

async function handleApprove(
  interaction: ButtonInteraction,
  sessionId: string,
): Promise<void> {
  await interaction.deferReply();

  const session = await getSession(sessionId);
  if (!session) {
    await interaction.editReply({
      content: "Session not found.",
    });
    return;
  }

  // Check session state
  if (session.state !== SessionState.PENDING_APPROVAL) {
    await interaction.editReply({
      content: `Cannot approve: session is in '${session.state}' state.`,
    });
    return;
  }

  // Get pending changes
  const pendingChanges = getPendingChanges(session);
  if (!pendingChanges || pendingChanges.changes.length === 0) {
    await interaction.editReply({
      content: "No pending changes found in session.",
    });
    return;
  }

  // Check GitHub auth
  const hasAuth = await hasValidAuth(interaction.user.id);
  if (!hasAuth) {
    const authUrl = getAuthorizationUrl(interaction.user.id);
    await interaction.editReply({
      content: `You need to connect your GitHub account first.\n\n[Click here to authorize](${authUrl})`,
    });
    return;
  }

  // Verify cloned repo path exists
  if (!session.clonedRepoPath) {
    await interaction.editReply({
      content: "No cloned repository found for this session.",
    });
    return;
  }

  // Update state to approved
  await updateSessionState(sessionId, SessionState.APPROVED);

  // Create PR
  const title = generatePRTitle(session.summary ?? "Changes from Discord");
  const body = generatePRBody(
    session.summary ?? "Changes made via Discord bot",
    pendingChanges.changes,
    interaction.user.username,
  );

  const result = await createPullRequest({
    userId: interaction.user.id,
    repoPath: session.clonedRepoPath,
    branchName: pendingChanges.branchName,
    baseBranch: pendingChanges.baseBranch,
    title,
    body,
    changes: pendingChanges.changes,
  });

  if (!result.success) {
    // Revert state
    await updateSessionState(sessionId, SessionState.PENDING_APPROVAL);
    await interaction.editReply({
      content: `Failed to create PR: ${result.error ?? "Unknown error"}`,
    });
    return;
  }

  // Update session with PR URL
  await updatePrUrl(sessionId, result.prUrl ?? "");

  // Update the original message
  try {
    const message = await interaction.message.fetch();
    const EmbedBuilder = await getEmbedBuilder();
    const embed = new EmbedBuilder()
      .setTitle("Pull Request Created")
      .setDescription(session.summary ?? "Changes applied")
      .addFields(
        { name: "Repository", value: session.repoName, inline: true },
        { name: "Status", value: "PR Created", inline: true },
        { name: "PR URL", value: result.prUrl ?? "N/A" },
      )
      .setColor(0x57f287)
      .setFooter({ text: `Approved by ${interaction.user.username}` });

    await message.edit({
      embeds: [embed],
      components: [], // Remove buttons
    });
  } catch (error) {
    logger.warn("Failed to update original message", { error });
  }

  await interaction.editReply({
    content: `Pull request created: ${result.prUrl ?? "N/A"}`,
  });
}

async function handleReject(
  interaction: ButtonInteraction,
  sessionId: string,
): Promise<void> {
  // Cleanup cloned repo
  await cleanupSessionClone(sessionId);

  await updateSessionState(sessionId, SessionState.REJECTED);

  // Update the original message
  try {
    const message = await interaction.message.fetch();
    const existingEmbed = message.embeds[0];

    const EmbedBuilder = await getEmbedBuilder();
    const embed = new EmbedBuilder()
      .setTitle("Changes Rejected")
      .setDescription(existingEmbed?.description ?? "Changes were rejected")
      .setColor(0xed4245)
      .setFooter({ text: `Rejected by ${interaction.user.username}` });

    await message.edit({
      embeds: [embed],
      components: [], // Remove buttons
    });
  } catch (error) {
    logger.warn("Failed to update original message", { error });
  }

  await interaction.reply({
    content: "Changes rejected. The session has been closed.",
    flags: 64,
  });
}

async function handleContinue(
  interaction: ButtonInteraction,
  sessionId: string,
): Promise<void> {
  // Extend session and mark as active for continued editing
  await updateSessionState(sessionId, SessionState.ACTIVE);
  await extendSession(sessionId);

  await interaction.reply({
    content:
      "Session continued. You can now provide additional editing instructions in the chat.",
    flags: 64,
  });
}
