import type { CustomNightSnapshot, CustomTeam } from "@scout-for-lol/data";
import { TRPCError } from "@trpc/server";

export function hasCustomHostControl(
  snapshot: CustomNightSnapshot,
  discordId: string,
  discordAdministrator: boolean,
): boolean {
  return (
    discordAdministrator ||
    snapshot.hostDiscordId === discordId ||
    snapshot.cohostDiscordIds.includes(discordId)
  );
}

export function assertCustomHostControl(
  snapshot: CustomNightSnapshot,
  discordId: string,
  discordAdministrator: boolean,
): void {
  if (!hasCustomHostControl(snapshot, discordId, discordAdministrator)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "This action requires host, cohost, or Discord administrator authority",
    });
  }
}

export function assertActiveCaptain(
  snapshot: CustomNightSnapshot,
  discordId: string,
): CustomTeam {
  const game = snapshot.currentGame;
  if (game?.state !== "DRAFTING" || game.activeCaptain === null) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "There is no active captain pick",
    });
  }
  const captain = game.participants.find(
    (participant) => participant.discordId === discordId,
  );
  if (
    captain === undefined ||
    !captain.captain ||
    captain.team !== game.activeCaptain
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only the active captain may make this pick",
    });
  }
  return game.activeCaptain;
}
