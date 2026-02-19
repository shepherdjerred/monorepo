import { createTool } from "@shepherdjerred/birmel/voltagent/tools/create-tool.ts";
import { z } from "zod";
import type { ButtonBuilder as ButtonBuilderType } from "discord.js";
import { getDiscordClient } from "@shepherdjerred/birmel/discord/client.ts";
import { getRequestContext } from "@shepherdjerred/birmel/mastra/tools/request-context.ts";
import { hasValidAuth, deleteAuth } from "@shepherdjerred/birmel/editor/github-oauth.ts";
import { getGitHubConfig } from "@shepherdjerred/birmel/editor/config.ts";

export const connectGitHubTool = createTool({
  id: "connect-github",
  description: `Connect or manage GitHub account for creating pull requests.
    Use this when the user wants to:
    - Connect their GitHub account
    - Link GitHub for PR creation
    - Check their GitHub connection status
    - Disconnect/unlink their GitHub account`,
  inputSchema: z.object({
    action: z
      .enum(["connect", "status", "disconnect"])
      .default("connect")
      .describe("Action to perform: connect, status, or disconnect"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    authUrl: z.string().optional(),
    isConnected: z.boolean().optional(),
  }),
  execute: async ({ action }) => {
    const reqCtx = getRequestContext();
    if (reqCtx == null) {
      return {
        success: false,
        message: "Could not determine request context.",
      };
    }

    const config = getGitHubConfig();
    if (config == null) {
      return { success: false, message: "GitHub OAuth is not configured." };
    }
    const isConnected = await hasValidAuth(reqCtx.userId);

    if (action === "status") {
      return {
        success: true,
        message: isConnected
          ? "Your GitHub account is connected. You can create PRs."
          : "GitHub not connected. Use 'connect github' to link your account.",
        isConnected,
      };
    }

    if (action === "disconnect") {
      if (!isConnected) {
        return { success: false, message: "No GitHub account is connected." };
      }
      await deleteAuth(reqCtx.userId);
      return {
        success: true,
        message: "GitHub account disconnected.",
        isConnected: false,
      };
    }

    // action === "connect"
    if (isConnected) {
      return {
        success: true,
        message: "Your GitHub account is already connected!",
        isConnected: true,
      };
    }

    // Generate OAuth URL - derive from callback URL
    const authUrl = config.callbackUrl.replace(
      "/callback",
      `?user=${reqCtx.userId}`,
    );

    // Send embed with button to Discord
    const client = getDiscordClient();
    const channel = await client.channels.fetch(reqCtx.sourceChannelId);

    if (channel != null && "send" in channel) {
      const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } =
        await import("discord.js");

      const embed = new EmbedBuilder()
        .setTitle("Connect GitHub Account")
        .setDescription(
          "Click the button below to connect your GitHub account. This allows the bot to create pull requests on your behalf.",
        )
        .setColor(5_793_266);

      const row = new ActionRowBuilder<ButtonBuilderType>().addComponents(
        new ButtonBuilder()
          .setLabel("Connect GitHub")
          .setStyle(ButtonStyle.Link)
          .setURL(authUrl),
      );

      await channel.send({ embeds: [embed], components: [row] });
    }

    return {
      success: true,
      message: "Click the link above to connect your GitHub account.",
      authUrl,
      isConnected: false,
    };
  },
});
