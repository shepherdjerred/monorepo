/**
 * The runtime-role gate on customs voice moves.
 *
 * Moving players between the lobby and the team channels decides whom to move
 * by reading `member.voice.channelId` — see `moveMember` in `voice-service.ts`
 * — and that field is populated only by gateway VOICE_STATE_UPDATE events. A
 * REST guild-member payload carries roles and a nickname and no voice channel
 * at all, so on a role without {@link ScoutRuntimeCapabilities.voiceStateAccess}
 * it is null for everyone: the loop would move nobody, create or delete the
 * channels anyway, and report the arrangement ready. An operator would see
 * "voice ready" with all ten players still sitting in the lobby.
 *
 * REST cannot close this gap. Discord exposes an endpoint to *set* a member's
 * voice channel but none to read the one they are currently in, and the read is
 * what the decision needs. So the only honest behaviour is to refuse — and to
 * refuse at the top of each entry point, before any mutation is committed,
 * rather than part-way through an arrangement.
 *
 * ## Wave 6
 *
 * The durable fix is to stop running gateway-coupled mutations on whichever
 * role happens to serve the request. Route them to the gateway role instead: a
 * Temporal task queue polled only by that role is the natural mechanism, since
 * the customs surface already commits its mutations through a revision protocol
 * that tolerates an asynchronous effect. Until that exists, this refusal is
 * what keeps a split deployment from quietly doing nothing.
 */

import configuration from "#src/configuration.ts";
import { CustomAuthHttpError } from "#src/customs/activity/activity-auth.ts";

export function requireVoiceStateAccess(action: string): void {
  if (configuration.runtimeCapabilities.voiceStateAccess) return;
  throw new CustomAuthHttpError(
    503,
    `${action} needs Scout's Discord gateway connection, and this instance does not hold one. Run this action on the gateway role.`,
  );
}
