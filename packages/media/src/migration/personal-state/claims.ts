import type { z } from "zod";
import {
  PersonalMigrationClaimSchema,
  type PersonalMigrationClaim,
} from "#shared/personal-migration/contract.ts";
import type {
  AdoptionTargetSchema,
  MigrationSnapshot,
  MigrationRecord,
} from "#shared/migration.ts";
import type { MovieEditionKey } from "#shared/movie-editions/registry.ts";
import { recordKey } from "#migration/capture/capture-validation.ts";

type Target = z.infer<typeof AdoptionTargetSchema>;
type RequestRecord = Extract<MigrationRecord, { kind: "request" }>;
type EditionSelection = readonly {
  mediaId: string;
  edition: MovieEditionKey;
}[];
type PersonalClaimBase = Omit<PersonalMigrationClaim, "disposition" | "reason">;
type PersonalClaimsInput = {
  captureId: string;
  snapshot: MigrationSnapshot;
  targets: readonly Target[];
  bindings: readonly PersonalClaimBinding[];
  movieEditions: EditionSelection;
  existing: readonly { mediaId: string; userId: string; edition: string }[];
  historyOnly: readonly string[];
  deferUnboundRequesters?: true | undefined;
};
export type PersonalClaimBinding = {
  requesterSourceId: string;
  id: string;
  revision: number;
  userId: string;
  valid: boolean;
  permittedMediaKinds: readonly string[];
  plexAccountId?: string;
};
const live = (status: number | undefined) => status === 2 || status === 5;
const failed = (reason: string) => ({ mediaIds: [], reason });

function claimBase(
  input: Pick<PersonalClaimsInput, "captureId" | "snapshot">,
  record: RequestRecord,
  binding: PersonalClaimBinding | undefined,
  plexAccountId: string | undefined,
): PersonalClaimBase {
  return {
    captureId: input.captureId,
    provenanceKey: recordKey(input.snapshot, record),
    sourceId: record.sourceId,
    requesterSourceId: record.requesterSourceId,
    sourceStatus: record.sourceStatus ?? null,
    ...(plexAccountId === undefined ? {} : { plexAccountId }),
    userId: binding?.valid === true ? binding.userId : null,
    bindingId: binding?.id ?? null,
    bindingRevision: binding?.revision ?? null,
    mediaIds: [],
    edition: null,
    keepingPolicy: "temporary",
    interestState: "following",
  };
}

function personalRequestScope(
  record: RequestRecord,
  targets: readonly Target[],
  movieEditions: EditionSelection,
):
  | { mediaIds: string[]; reason: string; edition: null }
  | { mediaIds: string[]; reason: null; edition: MovieEditionKey } {
  const kind = record.scope === "movie" ? "movie" : "series";
  const ids = Object.entries(record.externalIds);
  const roots = targets.filter(
    (target) =>
      target.kind === kind &&
      ids.length > 0 &&
      ids.every(
        ([key, value]) => Reflect.get(target.externalIds, key) === value,
      ),
  );
  const root = roots[0];
  if (root === undefined || roots.length !== 1)
    return { ...failed("canonical_identity_not_exact"), edition: null };
  const selected = selectedMediaIds(record, root, targets);
  if (selected.reason !== null)
    return { ...failed(selected.reason), edition: null };
  const edition =
    kind === "movie"
      ? movieEditions.find((item) => item.mediaId === root.mediaId)?.edition
      : "default";
  if (edition === undefined)
    return {
      ...failed("owner_movie_edition_selection_required"),
      edition: null,
    };
  return { mediaIds: selected.mediaIds, reason: null, edition };
}

function blocked(base: PersonalClaimBase, reason: string) {
  return PersonalMigrationClaimSchema.parse({
    ...base,
    disposition: "blocked",
    reason,
  });
}

function activeClaim(
  input: PersonalClaimsInput,
  record: RequestRecord,
  base: PersonalClaimBase,
  binding: PersonalClaimBinding | undefined,
) {
  const kind = record.scope === "movie" ? "movie" : "series";
  const accessReason =
    binding?.valid === true
      ? binding.permittedMediaKinds.includes(kind)
        ? null
        : "requester_library_access_required"
      : "exact_plex_requester_binding_required";
  if (accessReason !== null && base.plexAccountId === undefined)
    return blocked(base, accessReason);
  const scope = personalRequestScope(
    record,
    input.targets,
    input.movieEditions,
  );
  if (base.plexAccountId !== undefined)
    return PersonalMigrationClaimSchema.parse({
      ...base,
      ...scope,
      userId: null,
      disposition: "deferred",
      reason: scope.reason ?? "awaiting_verified_plex_attachment",
    });
  if (scope.reason !== null) return blocked(base, scope.reason);
  // Native changes, including a cancellation or explicit Keep, always win.
  const existing = scope.mediaIds.every((mediaId) =>
    input.existing.some(
      (item) =>
        item.mediaId === mediaId &&
        item.userId === base.userId &&
        item.edition === scope.edition,
    ),
  );
  return PersonalMigrationClaimSchema.parse({
    ...base,
    ...scope,
    disposition: existing ? "existing" : "import",
    reason: existing ? "native_request_preserved" : null,
  });
}

function requestClaim(input: PersonalClaimsInput, record: RequestRecord) {
  const binding = input.bindings.find(
    (item) => item.requesterSourceId === record.requesterSourceId,
  );
  const capturedId =
    input.deferUnboundRequesters === true
      ? PersonalMigrationClaimSchema.shape.plexAccountId.safeParse(
          record.plexAccountId ?? undefined,
        )
      : undefined;
  const plexAccountId =
    capturedId?.success === true ? capturedId.data : undefined;
  const conflictingBinding =
    plexAccountId !== undefined &&
    binding !== undefined &&
    binding.plexAccountId !== plexAccountId;
  const base = claimBase(
    input,
    record,
    conflictingBinding ? undefined : binding,
    conflictingBinding ? undefined : plexAccountId,
  );
  if (input.historyOnly.includes(base.provenanceKey))
    return PersonalMigrationClaimSchema.parse({
      ...base,
      disposition: "history",
      reason: "owner_reviewed_history_only",
    });
  if (record.sourceStatus === undefined)
    return blocked(base, "source_request_status_not_captured");
  if (!live(record.sourceStatus))
    return PersonalMigrationClaimSchema.parse({
      ...base,
      disposition: "history",
      reason: "source_request_not_approved_or_fulfilled",
    });
  if (!record.active)
    return blocked(base, "source_request_status_inconsistent");
  return conflictingBinding
    ? blocked(base, "captured_plex_id_conflicts_with_requester_binding")
    : activeClaim(input, record, base, binding);
}

/** Source fulfillment never claims that a viewer watched or finished anything. */
export function personalClaims(input: PersonalClaimsInput) {
  return ["seerr", "overseerr", "jellyseerr"].includes(
    input.snapshot.sourceKind,
  )
    ? input.snapshot.records
        .filter((record) => record.kind === "request")
        .map((record) => requestClaim(input, record))
    : [];
}

function selectedMediaIds(
  record: RequestRecord,
  root: Target,
  targets: readonly Target[],
) {
  if (record.scope === "movie" || record.scope === "series")
    return { mediaIds: [root.mediaId], reason: null };
  if (record.scope !== "season") return failed("episode_scope_not_captured");
  if (record.seasonStatuses === undefined)
    return failed("source_season_status_not_captured");
  const seasons = record.seasonStatuses
    .filter((season) => live(season.status))
    .map((season) => season.season)
    .sort((a, b) => a - b);
  if (
    seasons.length === 0 ||
    new Set(seasons).size !== seasons.length ||
    JSON.stringify(seasons) !==
      JSON.stringify([...record.seasons].sort((a, b) => a - b))
  )
    return failed("selected_seasons_inconsistent");
  const mediaIds: string[] = [];
  const ids = Object.entries(record.externalIds);
  for (const season of seasons) {
    const matches = targets.filter(
      (target) =>
        target.kind === "season" &&
        target.season === season &&
        ids.every(
          ([key, value]) =>
            Reflect.get(target.seriesExternalIds ?? target.externalIds, key) ===
            value,
        ),
    );
    const match = matches[0];
    if (match === undefined || matches.length !== 1)
      return failed("selected_season_catalog_incomplete");
    mediaIds.push(match.mediaId);
  }
  return { mediaIds, reason: null };
}
