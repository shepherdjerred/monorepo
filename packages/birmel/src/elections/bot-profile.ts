import { getDiscordClient } from "@shepherdjerred/birmel/discord/client.js";
import { getDiscordIdForPersona } from "./persona-discord-ids.ts";
import { generateNickname } from "./winner.ts";
import { loggers } from "@shepherdjerred/birmel/utils/index.js";

const logger = loggers.scheduler.child("elections").child("profile");

/**
 * Updates the bot's avatar and bio to match the winning persona's Discord user.
 * This is called after an election winner is determined.
 */
export async function updateBotProfile(personaName: string): Promise<void> {
  const discordId = getDiscordIdForPersona(personaName);
  if (
    discordId == null ||
    discordId.length === 0 ||
    discordId.startsWith("TODO_")
  ) {
    logger.warn(
      "No Discord ID configured for persona, skipping profile update",
      {
        personaName,
      },
    );
    return;
  }

  const client = getDiscordClient();
  if (client.user == null) {
    logger.error("Discord client user not available");
    return;
  }

  try {
    // Fetch the winner's Discord user to get their avatar
    const winnerUser = await client.users.fetch(discordId, { force: true });

    // Update bot avatar to match winner's avatar
    await updateBotAvatar(
      winnerUser.displayAvatarURL({ size: 512, extension: "png" }),
    );

    // Fetch and update bio using REST API
    await updateBotBio(discordId);

    // Update bot username to match persona
    await updateBotUsername(personaName);

    logger.info("Bot profile updated to match winner", {
      personaName,
      discordId,
    });
  } catch (error) {
    logger.error("Failed to update bot profile", error, {
      personaName,
      discordId,
    });
  }
}

async function updateBotAvatar(avatarUrl: string): Promise<void> {
  const client = getDiscordClient();
  if (client.user == null) {
    return;
  }

  try {
    // Fetch the avatar image
    const response = await fetch(avatarUrl);
    if (!response.ok) {
      logger.error("Failed to fetch avatar image", {
        avatarUrl,
        status: response.status,
      });
      return;
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    await client.user.setAvatar(buffer);
    logger.info("Bot avatar updated", { avatarUrl });
  } catch (error) {
    logger.error("Failed to update bot avatar", error, { avatarUrl });
  }
}

async function updateBotBio(winnerDiscordId: string): Promise<void> {
  const client = getDiscordClient();
  if (client.user == null) {
    return;
  }

  try {
    // Fetch the winner's profile to get their bio
    // Note: This requires the user to be in a mutual guild and may not always include bio
    const userProfile = (await client.rest.get(
      `/users/${winnerDiscordId}`,
    )) as { bio?: string };
    const bio = userProfile.bio ?? "";

    // Update the bot's bio using REST API
    await client.rest.patch("/users/@me", {
      body: { bio },
    });
    logger.info("Bot bio updated", {
      bio: bio.slice(0, 50) + (bio.length > 50 ? "..." : ""),
    });
  } catch (error) {
    logger.error("Failed to update bot bio", error, { winnerDiscordId });
    // Bio update failure is not critical, continue without throwing
  }
}

async function updateBotUsername(personaName: string): Promise<void> {
  const client = getDiscordClient();
  if (client.user == null) {
    return;
  }

  try {
    // Generate username using the same pattern as nickname (e.g., "aaron" -> "Bvaron")
    const username = generateNickname(personaName);

    // Update the bot's username using REST API
    await client.rest.patch("/users/@me", {
      body: { username },
    });
    logger.info("Bot username updated", { personaName, username });
  } catch (error) {
    logger.error("Failed to update bot username", error, { personaName });
    // Username update failure is not critical, continue without throwing
  }
}
