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
export type PersonalClaimBinding = {
  requesterSourceId: string;
  id: string;
  revision: number;
  userId: string;
  valid: boolean;
  permittedMediaKinds: readonly string[];
};
const live = (status: number | undefined) => status === 2 || status === 5;
const failed = (reason: string) => ({ mediaIds: [], reason });

function claimBase(
  input: Pick<Parameters<typeof personalClaims>[0], "captureId" | "snapshot">,
  record: Extract<MigrationRecord, { kind: "request" }>,
  binding: PersonalClaimBinding | undefined,
): Omit<PersonalMigrationClaim, "disposition" | "reason"> {
  return {
    captureId: input.captureId,
    provenanceKey: recordKey(input.snapshot, record),
    sourceId: record.sourceId,
    requesterSourceId: record.requesterSourceId,
    sourceStatus: record.sourceStatus ?? null,
    userId: binding?.valid === true ? binding.userId : null,
    bindingId: binding?.id ?? null,
    bindingRevision: binding?.revision ?? null,
    mediaIds: [],
    edition: null,
    keepingPolicy: "temporary",
    interestState: "following",
  };
}

/** Source fulfillment never claims that a viewer watched or finished anything. */
export function personalClaims(input: {
  captureId: string;
  snapshot: MigrationSnapshot;
  targets: readonly Target[];
  bindings: readonly PersonalClaimBinding[];
  movieEditions: readonly { mediaId: string; edition: MovieEditionKey }[];
  existing: readonly { mediaId: string; userId: string; edition: string }[];
  historyOnly: readonly string[];
}) {
  if (!["seerr", "overseerr", "jellyseerr"].includes(input.snapshot.sourceKind))
    return [];
  return input.snapshot.records
    .filter((record) => record.kind === "request")
    .map((record) => {
      const binding = input.bindings.find(
        (item) => item.requesterSourceId === record.requesterSourceId,
      );
      const base = claimBase(input, record, binding);
      const blocked = (reason: string) =>
        PersonalMigrationClaimSchema.parse({
          ...base,
          disposition: "blocked",
          reason,
        });
      if (input.historyOnly.includes(base.provenanceKey))
        return PersonalMigrationClaimSchema.parse({
          ...base,
          disposition: "history",
          reason: "owner_reviewed_history_only",
        });
      if (record.sourceStatus === undefined)
        return blocked("source_request_status_not_captured");
      if (!live(record.sourceStatus))
        return PersonalMigrationClaimSchema.parse({
          ...base,
          disposition: "history",
          reason: "source_request_not_approved_or_fulfilled",
        });
      if (!record.active) return blocked("source_request_status_inconsistent");
      if (binding?.valid !== true)
        return blocked("exact_plex_requester_binding_required");
      const kind = record.scope === "movie" ? "movie" : "series";
      if (!binding.permittedMediaKinds.includes(kind))
        return blocked("requester_library_access_required");
      const ids = Object.entries(record.externalIds);
      const roots = input.targets.filter(
        (target) =>
          target.kind === kind &&
          ids.length > 0 &&
          ids.every(
            ([key, value]) => Reflect.get(target.externalIds, key) === value,
          ),
      );
      const root = roots[0];
      if (root === undefined || roots.length !== 1)
        return blocked("canonical_identity_not_exact");
      const selected = selectedMediaIds(record, root, input.targets);
      if (selected.reason !== null) return blocked(selected.reason);
      const mediaIds = selected.mediaIds;
      const edition =
        kind === "movie"
          ? input.movieEditions.find((item) => item.mediaId === root.mediaId)
              ?.edition
          : "default";
      if (edition === undefined)
        return blocked("owner_movie_edition_selection_required");
      const existing = new Set(
        mediaIds.filter((mediaId) =>
          input.existing.some(
            (item) =>
              item.mediaId === mediaId &&
              item.userId === binding.userId &&
              item.edition === edition,
          ),
        ),
      );
      // Native changes, including a cancellation or explicit Keep, always win.
      return PersonalMigrationClaimSchema.parse({
        ...base,
        mediaIds,
        edition,
        disposition: mediaIds.every((id) => existing.has(id))
          ? "existing"
          : "import",
        reason: mediaIds.every((id) => existing.has(id))
          ? "native_request_preserved"
          : null,
      });
    });
}

function selectedMediaIds(
  record: Extract<MigrationRecord, { kind: "request" }>,
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
