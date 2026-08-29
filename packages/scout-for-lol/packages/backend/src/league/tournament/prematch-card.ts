import { EmbedBuilder } from "discord.js";
import type { TournamentLobbyRecord } from "#src/league/tournament/lobby-store.ts";

/**
 * The prematch card built from what Scout itself knows.
 *
 * This is the product, not a fallback. Spectator does not reliably surface
 * custom lobbies, and lobby events carry a PUUID per join but never a side.
 * Open lobbies therefore announce a team-neutral Riot-ID roster without
 * inventing a team split. If identity enrichment is unavailable, the card uses
 * only the accurate joined-player count. Old declared-roster rows retain their
 * more detailed card while they age out.
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

function hasDeclaredRosters(lobby: TournamentLobbyRecord): boolean {
  return lobby.blueAliases.length > 0 || lobby.redAliases.length > 0;
}

export function buildLobbyPrematchEmbed(
  lobby: TournamentLobbyRecord,
  joinedPlayerNames: readonly string[] | undefined = undefined,
): EmbedBuilder {
  const size = `${lobby.teamSize.toString()}v${lobby.teamSize.toString()}`;
  const embed = new EmbedBuilder()
    .setColor(BLUE)
    .setTitle(`Custom game starting — ${size}`)
    .setDescription(
      `${mapLabel(lobby.mapType)} · ${pickLabel(lobby.pickType)}`,
    );

  if (hasDeclaredRosters(lobby)) {
    embed.addFields(
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
  } else {
    embed.addFields({
      name: joinedPlayerNames === undefined ? "Open lobby" : "Players",
      value:
        joinedPlayerNames === undefined
          ? `${lobby.joinedPuuids.length.toString()} player(s) joined · teams are set in League`
          : rosterLines(joinedPlayerNames),
    });
  }

  return embed;
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
    hasDeclaredRosters(lobby)
      ? `${lobby.blueAliases.join(", ")} vs ${lobby.redAliases.join(", ")}`
      : `Open lobby · ${lobby.teamSize.toString()}v${lobby.teamSize.toString()} · ${lobby.joinedPuuids.length.toString()} joined`,
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
