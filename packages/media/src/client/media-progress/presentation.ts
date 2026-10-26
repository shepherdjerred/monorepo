import type { MediaVisibility } from "#shared/visibility/detail.ts";
import { seededDuration } from "./format.ts";

type Torrent = MediaVisibility["torrents"][number];
type Diagnostics = NonNullable<Torrent["diagnostics"]>;
type Policy = Diagnostics["policy"];

function collectionAssociationMessage(
  association: MediaVisibility["playback"]["association"],
): string {
  const messages: string[] = [];
  if (association.legacyUnverifiedItems > 0)
    messages.push(
      `${String(association.legacyUnverifiedItems)} visible ${association.legacyUnverifiedItems === 1 ? "episode has an unverified legacy Plex association" : "episodes have unverified legacy Plex associations"}.`,
    );
  if (association.reconciliationRequiredItems > 0)
    messages.push(
      `${String(association.reconciliationRequiredItems)} visible ${association.reconciliationRequiredItems === 1 ? "episode needs" : "episodes need"} reconciliation before playback can be verified.`,
    );
  return messages.join(" ");
}

export function playbackMessage(playback: MediaVisibility["playback"]): string {
  if (playback.scope === "collection")
    return [
      `${String(playback.playableItems)} of ${String(playback.visibleItems)} visible episodes are ready to watch.`,
      collectionAssociationMessage(playback.association),
      playback.playable && playback.upgradeInProgress
        ? "Upgrades can continue while these versions remain playable."
        : "",
    ]
      .filter(Boolean)
      .join(" ");
  if (playback.playable)
    return playback.upgradeInProgress
      ? "Your current version is ready to watch while an upgrade is in progress."
      : "Your current version is ready to watch in Plex.";
  if (playback.association.reconciliationRequiredItems > 0)
    return "This copy needs reconciliation before playback can be verified.";
  return playback.association.legacyUnverifiedItems > 0
    ? "An existing copy has a legacy Plex association that is unverified. Playback needs fresh verification."
    : "Playback has not been verified. A completed download still needs import and Plex checks.";
}

export function playbackHeading(playback: MediaVisibility["playback"]): string {
  if (!playback.playable) {
    if (playback.association.reconciliationRequiredItems > 0)
      return "Playback needs reconciliation";
    return playback.association.legacyUnverifiedItems > 0
      ? "Plex verification needed"
      : "Playback pending";
  }
  return playback.scope === "collection" &&
    playback.playableItems < playback.visibleItems
    ? "Some episodes ready"
    : "Ready to watch";
}

const freshnessText: Record<Torrent["freshness"], string> = {
  fresh: "Recent observation",
  stale: "Observation is stale; current progress is unknown.",
  missing: "No download observation has been recorded.",
  future: "Observation time is invalid; current progress is unknown.",
  old_epoch: "Recorded before recovery; current progress is unverified.",
};
export function observationMessage(torrent: Torrent): string {
  return freshnessText[torrent.freshness];
}

export function torrentHeading(torrent: Torrent): string {
  if (torrent.freshness !== "fresh") return "Last recorded download";
  if (torrent.state === "removed") return "Download source removed";
  if (torrent.state === "removing") return "Source removal in progress";
  if (torrent.state === "missing") return "Download source unavailable";
  return torrent.progress === 1 ? "Download complete" : "Download progress";
}

export function attemptLabel(state: string): string {
  const labels: Record<string, string> = {
    reserved: "Release reserved",
    submitting: "Sending to downloader",
    submission_unknown: "Submission needs reconciliation",
    downloading: "Downloading",
    ready: "Download ready for inspection",
    validating: "Inspecting and staging files",
    imported: "Imported; Plex verification pending",
    completed: "Import completed",
    failed: "Acquisition blocked",
    cancelled: "Acquisition cancelled",
    obsolete: "Acquisition superseded",
    rolled_back: "Previous version restored",
    blocked: "Acquisition blocked",
  };
  return labels[state] ?? "Unknown acquisition stage";
}

const reasons: Record<
  NonNullable<Diagnostics["cleanup"]>["reason"] & string,
  string
> = {
  source_cleanup_disabled:
    "Source cleanup is disabled or its authority needs review.",
  torrent_missing: "The download source could not be found.",
  torrent_policy_drift:
    "Downloader settings differ from the recorded seeding policy.",
  submission_ownership_unknown: "Download ownership is not confirmed.",
  removal_outcome_unknown:
    "A previous removal has an uncertain outcome. Reconciliation is required.",
  source_dependencies_changed: "Work depending on this source has changed.",
  source_ownership_unproven: "The source’s ownership could not be proven.",
  source_directory_shared: "Other downloads share the source directory.",
  unowned_torrent: "This download is not owned by Media.",
  download_incomplete: "The download is not complete.",
  source_in_use: "Import or recovery work still needs this source.",
  invalid_observation: "The recorded download observation is invalid.",
  policy_required: "A seeding policy must be established before cleanup.",
  policy_unverified:
    "The private tracker’s seeding requirements are not verified.",
  obligations_satisfied: "Recorded seeding requirements are met.",
  seeding_required: "Recorded seeding requirements are not yet met.",
};
export function cleanupReason(
  reason: NonNullable<Diagnostics["cleanup"]>["reason"],
): string {
  return reason === null
    ? "No additional reason was recorded."
    : reasons[reason];
}

const protectionReasons: Record<Diagnostics["protections"][number], string> = {
  unowned_torrent: reasons.unowned_torrent,
  old_epoch: "Download authority predates recovery and needs review.",
  missing_observation: "No downloader observation is available.",
  stale_observation: "The downloader observation is stale.",
  future_observation: "The downloader observation has an invalid future time.",
  source_in_use: reasons.source_in_use,
  torrent_policy_drift: reasons.torrent_policy_drift,
  submission_outcome_unknown: "A download submission has an uncertain outcome.",
  removal_outcome_unknown: reasons.removal_outcome_unknown,
};
export function protectionReason(
  reason: Diagnostics["protections"][number],
): string {
  return protectionReasons[reason];
}

function privateRequirements(
  policy: Exclude<Policy, { kind: "public" | "unknown" }>,
  seconds: number | null,
): string[] {
  const requirements: string[] = [];
  if (policy.ratio !== null)
    requirements.push(`Share ratio ${String(policy.ratio)}`);
  if (seconds !== null)
    requirements.push(`${seededDuration(seconds)} of actual seeded time`);
  else if (policy.kind === "privatehd" || policy.sizeRule !== null)
    requirements.push("Size-dependent seeded time");
  else if (policy.minimumSeconds !== null)
    requirements.push(
      `${seededDuration(policy.minimumSeconds)} of actual seeded time`,
    );
  return requirements;
}
export function policyDescription(diagnostics: Diagnostics): string {
  const policy = diagnostics.policy;
  if (policy.kind === "unknown")
    return "Seeding policy unknown. Cleanup remains protected.";
  if (policy.kind === "public")
    return "Share ratio 1 OR 7 days of actual seeded time.";
  if (!policy.verified)
    return "Private tracker policy is unverified. Cleanup remains protected.";
  const requirements = privateRequirements(
    policy,
    diagnostics.obligation?.requiredSeconds ?? null,
  );
  if (requirements.length === 0)
    return "No verified seeding threshold is recorded. Cleanup remains protected.";
  const join =
    policy.kind === "privatehd" || policy.combination === "any"
      ? " OR "
      : " AND ";
  return `${requirements.join(join)}.`;
}
