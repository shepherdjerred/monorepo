export type PackEpisode = {
  mediaId: string;
  identityConfirmed: boolean;
  intentionallyRemoved: boolean;
  explicitlyRerequested: boolean;
  currentIsSuperior: boolean;
};

/** A pack has one immutable sponsor, including valid additional episodes. */
export function planSeasonPack(
  sponsor: { requestId: string; userId: string },
  episodes: readonly PackEpisode[],
) {
  const seen = new Set<string>();
  return episodes.map((episode) => {
    if (seen.has(episode.mediaId))
      throw new Error(`Duplicate episode coverage: ${episode.mediaId}`);
    seen.add(episode.mediaId);
    const reason = episode.identityConfirmed
      ? episode.intentionallyRemoved && !episode.explicitlyRerequested
        ? "intentional_removal"
        : episode.currentIsSuperior
          ? "existing_version_superior"
          : "publish"
      : "identity_unconfirmed";
    return {
      mediaId: episode.mediaId,
      publish: reason === "publish",
      reason,
      sponsorRequestId: sponsor.requestId,
      requesterId: sponsor.userId,
    };
  });
}

export type Intent = {
  generation: number;
  desiredPresence: boolean;
  monitoring: boolean;
  intentionallyRemoved: boolean;
};

export function changeIntent(
  intent: Intent,
  action: "request" | "remove" | "cancel_last_request",
): Intent {
  return {
    generation: intent.generation + 1,
    desiredPresence:
      action === "request" ||
      (action === "cancel_last_request" && intent.desiredPresence),
    monitoring: action === "request",
    intentionallyRemoved:
      action === "remove" ||
      (action === "cancel_last_request" && intent.intentionallyRemoved),
  };
}

export function canPublish(
  intent: Intent,
  acquisitionGeneration: number,
): boolean {
  return (
    intent.generation === acquisitionGeneration &&
    intent.desiredPresence &&
    !intent.intentionallyRemoved
  );
}

export function requiredSubtitleLanguages(
  claims: readonly { active: boolean; languages: readonly string[] }[],
): string[] {
  return [
    ...new Set(
      claims
        .filter((claim) => claim.active)
        .flatMap((claim) => claim.languages),
    ),
  ].sort();
}
