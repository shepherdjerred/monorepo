import type { DiscordUser } from "@shepherdjerred/discord-plays-core/auth/protocol.ts";
import type { DriverFeedAdmit } from "@shepherdjerred/discord-plays-core/driver-feed/service.ts";
import type { PlayPolicy } from "./play-policy.ts";

export function voiceAdmission({
  identify,
  policy,
  publicOrigin,
}: {
  identify: (cookieHeader: string | undefined) => DiscordUser | undefined;
  policy: Pick<PlayPolicy, "canWatch">;
  publicOrigin: string;
}): DriverFeedAdmit {
  return (request) => {
    if (request.headers.origin !== publicOrigin) {
      return { admitted: false, reason: "same-origin access is required" };
    }
    const cookie = request.headers.cookie;
    const user = identify(cookie);
    if (!policy.canWatch(user)) {
      return {
        admitted: false,
        reason: "sign in and join the game's voice channel",
      };
    }
    return {
      admitted: true,
      isStillAdmitted: () => {
        const current = identify(cookie);
        return (
          current?.discordId === user?.discordId && policy.canWatch(current)
        );
      },
    };
  };
}
