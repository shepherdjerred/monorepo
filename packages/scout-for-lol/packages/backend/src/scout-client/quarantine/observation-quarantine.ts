import {
  type ScoutClientObservation,
  type ScoutClientObservationQuarantineReason,
} from "@scout-for-lol/data";
import { gameflowCarriesRoster } from "#src/scout-client/observation-identity.ts";

function payloadContainsPuuid(payload: unknown, puuid: string): boolean {
  if (payload === puuid) return true;
  return Array.isArray(payload)
    ? payload.some((value) => payloadContainsPuuid(value, puuid))
    : payload !== null &&
        typeof payload === "object" &&
        Object.entries(payload).some(
          ([key, value]) =>
            ((key === "puuid" || key === "summonerPuuid") && value === puuid) ||
            payloadContainsPuuid(value, puuid),
        );
}

export function observationQuarantineReason(
  observation: ScoutClientObservation,
  verifiedPuuids: ReadonlySet<string>,
  acceptedAppVersions: ReadonlySet<string>,
  now: Date,
): ScoutClientObservationQuarantineReason | null {
  if (!acceptedAppVersions.has(observation.appVersion)) {
    return "unverified_app_version";
  }
  if (
    new Date(observation.capturedAt).getTime() >
    now.getTime() + 5 * 60 * 1000
  ) {
    return "future_timestamp";
  }
  if (
    observation.localPuuid !== undefined &&
    !verifiedPuuids.has(observation.localPuuid)
  ) {
    return "unverified_local_puuid";
  }
  const participantKinds = new Set(["lobby", "champ_select", "post_game"]);
  if (
    participantKinds.has(observation.kind) ||
    gameflowCarriesRoster(observation)
  ) {
    if (observation.localPuuid === undefined) {
      return "missing_observer_puuid";
    }
    if (!payloadContainsPuuid(observation.payload, observation.localPuuid)) {
      return "observer_puuid_not_in_payload";
    }
  }
  return observation.kind === "post_game" && observation.gameId === undefined
    ? "missing_post_game_id"
    : null;
}
