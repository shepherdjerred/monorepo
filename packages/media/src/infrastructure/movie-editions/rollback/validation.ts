import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  MovieRollbackIntentV1,
  MovieRollbackPhysicalV1,
} from "#shared/movie-editions/rollback/physical.ts";
import type { MoviePublicationAssetV2 } from "#shared/movie-editions/publication-v2.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import type { MovieRollbackPlexV1 } from "#shared/movie-editions/rollback/plex.ts";
import { assertMovieRollbackCanonical } from "./canonical.ts";
import { assertMovieRollbackOriginalIdentitiesV1 } from "./identities.ts";
import { assertRequestedMovieRollbackCaptionsV1 } from "./manual/manual-captions.ts";

export function assertMovieRollbackAdmissionClockV1(
  intent: MovieRollbackIntentV1,
) {
  const observed = Date.parse(intent.observedAt),
    admitted = Date.parse(intent.admittedAt),
    expires = Date.parse(intent.expiresAt);
  if (
    admitted < observed ||
    admitted >= expires ||
    expires > Math.min(observed + 60_000, Date.parse(intent.sdkExpiresAt)) ||
    (intent.invocation.mode === "manual_verified" &&
      (intent.cleanup === null ||
        admitted >= Date.parse(intent.cleanup.expiresAt)))
  )
    throw new Error(
      "Movie rollback admission changed its original Activity or cleanup deadline",
    );
}

/** Validate the complete union; caption partitioning is never an authority boundary. */
export function assertMovieRollbackPhysicalV1(
  intent: MovieRollbackIntentV1,
  receipt: MovieRollbackPhysicalV1,
) {
  assertMovieRollbackCanonical(
    receipt.bindingRaw,
    receipt.predecessor,
    receipt.bindingHash,
  );
  assertMovieRollbackCanonical(
    receipt.physicalEvidenceRaw,
    {
      effects: receipt.effects,
      participants: receipt.participants,
      journals: receipt.journals,
      ...(intent.invocation.mode === "manual_verified"
        ? { successorCaptions: receipt.successorCaptions }
        : {}),
    },
    receipt.physicalEvidenceHash,
  );
  const { predecessor: beforeA, successor: beforeB } = intent;
  const { predecessor: afterA, successor: afterB } = receipt;
  if (
    receipt.operationId !== intent.operationId ||
    receipt.intentId !== intent.id ||
    receipt.intentHash !== identityHash(intent) ||
    identityHash(receipt.scope) !== identityHash(intent.scope)
  )
    throw new Error(
      "Movie rollback physical completion changed its exact admitted parent",
    );
  assertPhysicalPair(intent, receipt);
  assertVideoFacts(beforeA, afterA);
  assertVideoFacts(beforeB, afterB);
  assertRestoredCaptions(intent, receipt);
  if (intent.invocation.mode === "manual_verified") {
    assertRequestedMovieRollbackCaptionsV1(intent, receipt);
  } else if (
    receipt.successorCaptions !== undefined ||
    receipt.playback !== undefined ||
    identityHash(
      [...beforeB.subtitles, ...beforeB.subtitleHistory].sort(byId),
    ) !==
      identityHash([...afterB.subtitles, ...afterB.subtitleHistory].sort(byId))
  )
    throw new Error(
      "Movie rollback changed retained successor caption records",
    );
  assertPhysicalEvidence(intent, receipt);
  assertMovieRollbackOriginalIdentitiesV1(intent, receipt);
  const observed = Date.parse(receipt.observedAt),
    expires = Date.parse(receipt.expiresAt),
    completed = Date.parse(receipt.committedAt);
  if (
    completed < observed ||
    completed >= expires ||
    expires > Math.min(observed + 60_000, Date.parse(receipt.sdkExpiresAt))
  )
    throw new Error(
      "Movie rollback completion changed its original invocation deadline",
    );
}

function assertPhysicalPair(
  intent: MovieRollbackIntentV1,
  receipt: MovieRollbackPhysicalV1,
) {
  const entry = intent.source.reference.intent.entries[0].entry;
  const original = intent.source.reference.intent.entries[0].predecessor;
  const { predecessor: beforeA, successor: beforeB } = intent;
  const { predecessor: afterA, successor: afterB } = receipt;
  if (
    beforeA.id !== original?.id ||
    beforeA.version !== original.version + 1 ||
    afterA.version !== original.version + 2 ||
    beforeB.id !== entry.assetId ||
    afterB.version !== beforeB.version + 1 ||
    afterA.state !== "published" ||
    afterB.state !== "rejected" ||
    afterA.path !== original.path ||
    afterB.path !==
      `${beforeA.path.slice(0, beforeA.path.lastIndexOf("/"))}/recover-${entry.assetId}` ||
    afterA.supersededByAssetId !== null ||
    afterB.supersededByAssetId !== beforeB.supersededByAssetId ||
    !afterA.coverage[0].current ||
    afterB.coverage[0].current ||
    identityHash(receipt.retiredPointer) !==
      identityHash({
        ...intent.pointer,
        revision: intent.pointer.revision + 1,
        evidence: null,
      })
  )
    throw new Error(
      "Movie rollback physical completion changed its exact admitted pair or pointer retirement",
    );
}

function byId(left: { id: string }, right: { id: string }) {
  return left.id.localeCompare(right.id);
}

function assertVideoFacts(
  before: MoviePublicationAssetV2,
  after: MoviePublicationAssetV2,
) {
  const {
    version: _v,
    state: _s,
    path: _p,
    coverage: _c,
    supersededByAssetId: _b,
    subtitles: _t,
    subtitleHistory: _h,
    ...original
  } = before;
  const {
    version: _av,
    state: _as,
    path: _ap,
    coverage: _ac,
    supersededByAssetId: _ab,
    subtitles: _at,
    subtitleHistory: _ah,
    ...current
  } = after;
  if (identityHash(original) !== identityHash(current))
    throw new Error(
      "Movie rollback changed immutable video facts or original publication clocks",
    );
}

function assertRestoredCaptions(
  intent: MovieRollbackIntentV1,
  receipt: MovieRollbackPhysicalV1,
) {
  const { predecessor: before } = intent;
  const { predecessor: after } = receipt;
  const source = intent.source.reference.intent.entries[0].predecessor;
  if (source === null) throw new Error("Movie rollback predecessor is missing");
  const original = new Map(
    [...source.subtitles, ...source.subtitleHistory].map((row) => [
      row.id,
      row,
    ]),
  );
  const current = new Map(
    [...after.subtitles, ...after.subtitleHistory].map((row) => [row.id, row]),
  );
  const beforeRows = [...before.subtitles, ...before.subtitleHistory];
  if (original.size !== beforeRows.length || current.size !== beforeRows.length)
    throw new Error(
      "Movie rollback changed the complete predecessor caption union",
    );
  const active = new Set(before.subtitles.map((row) => row.id));
  for (const caption of beforeRows) {
    if (!active.has(caption.id)) {
      if (identityHash(caption) !== identityHash(current.get(caption.id)))
        throw new Error(
          "Movie rollback changed independently owned caption history",
        );
      continue;
    }
    const prior = original.get(caption.id);
    if (
      prior === undefined ||
      caption.state !== "superseded" ||
      caption.videoVersion !== before.version ||
      caption.videoChecksum !== before.checksum ||
      caption.ownershipEpoch !== before.ownershipEpoch ||
      identityHash({
        ...caption,
        version: caption.version + 1,
        state: "installed",
        videoVersion: after.version,
        path: prior.path,
      }) !== identityHash(current.get(caption.id))
    )
      throw new Error(
        "Movie rollback caption lost its exact original owned transition",
      );
  }
}

function assertPhysicalEvidence(
  intent: MovieRollbackIntentV1,
  receipt: MovieRollbackPhysicalV1,
) {
  const entry = intent.source.reference.intent.entries[0].entry;
  const operations = [
    `recover-${entry.assetId}`,
    ...entry.previousSidecars.map((row) => `recover-${row.quarantineId}`),
  ];
  const prefix = intent.source.outcome.effects;
  if (
    receipt.effects.length <= prefix.length ||
    identityHash(receipt.effects.slice(0, prefix.length)) !==
      identityHash(prefix) ||
    receipt.effects.some(
      (effect, index) =>
        effect.ordinal !== index ||
        (index >= prefix.length && !operations.includes(effect.operationId)),
    )
  )
    throw new Error(
      "Movie rollback lost its complete causal committed and inverse effect chain",
    );
  if (receipt.journals.length !== operations.length)
    throw new Error("Movie rollback inverse journal inventory is incomplete");
  for (const operationId of operations) {
    const journal = receipt.journals.find(
      (row) => row.path === `journal/${operationId}.json`,
    );
    if (
      journal?.path !== `journal/${operationId}.json` ||
      createHash("sha256").update(journal.raw).digest("hex") !==
        journal.sha256 ||
      Buffer.byteLength(journal.raw).toString() !== journal.sizeBytes
    )
      throw new Error("Movie rollback inverse journal lost its literal bytes");
    const manifest = z
      .object({
        version: z.literal(1),
        operationId: z.string(),
        phase: z.literal("complete"),
        kind: z.enum(["rollback", "restore"]),
        sha256: z.string(),
        previousSha256: z.string().nullable(),
      })
      .parse(JSON.parse(journal.raw));
    const sidecar = entry.previousSidecars.find(
      (row) => operationId === `recover-${row.quarantineId}`,
    );
    if (
      manifest.operationId !== operationId ||
      manifest.kind !== (sidecar === undefined ? "rollback" : "restore") ||
      manifest.sha256 !== (sidecar?.checksum ?? entry.previousChecksum) ||
      manifest.previousSha256 !==
        (sidecar === undefined ? entry.checksum : null)
    )
      throw new Error(
        "Movie rollback journal differs from its real admitted inverse",
      );
  }
  const present = receipt.participants.filter(
    (row) => row.physical.state === "present",
  );
  if (
    !present.some(
      (row) =>
        row.assetId === receipt.predecessor.id &&
        row.subtitleId === null &&
        row.physical.root === "library" &&
        row.physical.path === entry.libraryPath &&
        row.physical.state === "present" &&
        row.physical.sha256 === receipt.predecessor.checksum,
    ) ||
    !present.some(
      (row) =>
        row.physical.root === "control" &&
        row.physical.path === `rollback/recover-${entry.assetId}` &&
        row.physical.state === "present" &&
        row.physical.sha256 === receipt.successor.checksum,
    )
  )
    throw new Error(
      "Movie rollback is missing its real restored and retained video identities",
    );
}

export function assertMovieRollbackPlexV1(
  receipt: MovieRollbackPlexV1,
  input: { intent: MovieRollbackIntentV1; physical: MovieRollbackPhysicalV1 },
) {
  const { expected, observation } = receipt;
  const association = observation.associations[0],
    group = expected.newGroups[0],
    target = expected.targets[0];
  const original = input.intent.originalItem;
  const part = association.item.media[0].parts[0];
  if (
    identityHash(expected.originalItem) !== identityHash(original) ||
    identityHash(expected.previous[0]) !==
      identityHash(input.physical.retiredPointer) ||
    expected.oldGroups.length > 0 ||
    identityHash(association.group) !== identityHash(group) ||
    identityHash(association.scope) !==
      identityHash(expected.previous[0].scope) ||
    identityHash(association.access) !== identityHash(expected.access[0]) ||
    expected.access.length !== 1 ||
    association.canonicalIdentityHash !== target.canonicalIdentityHash ||
    association.numberingHash !== target.numberingHash ||
    identityHash(association.definition) !== identityHash(target.definition) ||
    association.item.ratingKey !== original.ratingKey ||
    part.id !== original.part.id ||
    part.file !== original.part.file ||
    receipt.binding.associationHash !== identityHash(association)
  )
    throw new Error(
      "Movie rollback Plex completion changed its exact restored scope or original item and Part",
    );
  assertRestoredPlexGroup(receipt, input);
  assertRollbackPlexDeadline(receipt);
}

function assertRestoredPlexGroup(
  receipt: MovieRollbackPlexV1,
  input: { intent: MovieRollbackIntentV1; physical: MovieRollbackPhysicalV1 },
) {
  const group = receipt.expected.newGroups[0],
    asset = input.physical.predecessor;
  if (
    group.assetId !== asset.id ||
    group.assetVersion !== asset.version ||
    group.checksum !== asset.checksum ||
    group.sizeBytes !== asset.sizeBytes ||
    group.canonicalPath !== asset.path ||
    group.ownershipEpoch !== asset.ownershipEpoch ||
    group.canonicalRootId !== input.intent.scope.rootMediaId ||
    group.edition !== input.intent.scope.edition
  )
    throw new Error(
      "Movie rollback Plex group changed its exact restored physical version",
    );
}

function assertRollbackPlexDeadline(receipt: MovieRollbackPlexV1) {
  const verification = receipt.observation.verification;
  const observed = Date.parse(receipt.sdk.observedAt),
    started = Date.parse(verification.startedAt),
    completed = Date.parse(verification.completedAt),
    expires = Date.parse(verification.expiresAt);
  if (
    started < observed ||
    completed < started ||
    Date.parse(receipt.reboundAt) < completed ||
    Date.parse(receipt.committedAt) < Date.parse(receipt.reboundAt) ||
    Date.parse(receipt.committedAt) >= expires ||
    expires >
      Math.min(
        observed + 60_000,
        Date.parse(receipt.sdk.expiresAt),
        Date.parse(receipt.writerExpiresAt),
      )
  )
    throw new Error(
      "Movie rollback Plex completion changed its original SDK, writer or verification deadline",
    );
}
