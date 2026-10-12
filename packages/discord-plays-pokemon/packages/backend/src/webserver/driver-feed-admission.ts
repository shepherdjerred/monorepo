import type { DiscordUser } from "@shepherdjerred/discord-plays-core/auth/protocol.ts";
import type { DriverFeedAdmit } from "@shepherdjerred/discord-plays-core/driver-feed/service.ts";
import type { PlayPolicy } from "./play-policy.ts";

export function voiceAdmission({
  identify,
  policy,
  publicOrigin,
}: {
  identify: (
    cookieHeader: string | undefined,
  ) => Promise<DiscordUser | undefined>;
  policy: Pick<PlayPolicy, "canWatch">;
  publicOrigin: string;
}): DriverFeedAdmit {
  return async (request) => {
    if (request.headers.origin !== publicOrigin) {
      return { admitted: false, reason: "same-origin access is required" };
    }
    const user = await identify(request.headers.cookie);
    if (!policy.canWatch(user)) {
      return {
        admitted: false,
        reason: "sign in and join the game's voice channel",
      };
    }
    return { admitted: true, isStillAdmitted: () => policy.canWatch(user) };
  };
}
