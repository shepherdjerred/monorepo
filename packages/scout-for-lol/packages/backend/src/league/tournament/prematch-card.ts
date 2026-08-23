import { EmbedBuilder } from "discord.js";
import type { TournamentLobbyRecord } from "#src/league/tournament/lobby-store.ts";

/**
 * The prematch card built from what Scout itself knows.
 *
 * This is the product, not a fallback. Spectator does not reliably surface
 * custom lobbies, and lobby events carry a PUUID per join but never a side —
 * so the team split can only come from the `/lobby create` arguments. Building
 * the card from those makes the feature complete without spectator, and leaves
 * a successful spectator probe as an upgrade that edits this message in place.
 *
 * Deliberately does NOT fabricate a `RawCurrentGameInfo`. That value is written
 * to S3 as the canonical match store and the report lake is rebuilt from it, so
 * invented champion IDs would permanently corrupt ScoutQL, Explore, and AI
 * review. An absent champion is shown as absent.
 */

const BLUE = 0x3b_82_f6;

function rosterLines(aliases: readonly string[]): string {
  return aliases.length === 0
    ? "_nobody_"
    : aliases.map((alias) => `• ${alias}`).join("\n");
}

function mapLabel(mapType: string): string {
  if (mapType === "SUMMONERS_RIFT") return "Summoner's Rift";
  if (mapType === "HOWLING_ABYSS") return "Howling Abyss";
  if (mapType === "LEAGUE_CLASSIC") return "League Classic";
  return mapType;
}

function pickLabel(pickType: string): string {
  return pickType.toLowerCase().replaceAll("_", " ");
}

export function buildLobbyPrematchEmbed(
  lobby: TournamentLobbyRecord,
): EmbedBuilder {
  const size = `${lobby.blueAliases.length.toString()}v${lobby.redAliases.length.toString()}`;

  return new EmbedBuilder()
    .setColor(BLUE)
    .setTitle(`Custom game starting — ${size}`)
    .setDescription(`${mapLabel(lobby.mapType)} · ${pickLabel(lobby.pickType)}`)
    .addFields(
      {
        name: "Blue",
        value: rosterLines(lobby.blueAliases),
        inline: true,
      },
      {
        name: "Red",
        value: rosterLines(lobby.redAliases),
        inline: true,
      },
    );
  // The code, lobby name and password are deliberately absent: this message is
  // public, and the code is the join credential.
}

/**
 * Human summary for `/lobby status`, which is ephemeral to the caller and may
 * therefore include the join credential.
 */
export function describeLobby(lobby: TournamentLobbyRecord): string {
  const parts = [
    `**${lobby.code}** — ${lobby.state}`,
    `${lobby.blueAliases.join(", ")} vs ${lobby.redAliases.join(", ")}`,
  ];
  if (lobby.lobbyName !== undefined) {
    parts.push(`lobby: ${lobby.lobbyName}`);
  }
  if (lobby.password !== undefined) {
    parts.push(`password: ${lobby.password}`);
  }
  if (lobby.matchId !== undefined) {
    parts.push(`match: ${lobby.matchId}`);
  }
  return parts.join("\n");
}
