import type { z } from "zod";
import type {
  RecoveryDetailSchema,
  RecoveryListSchema,
} from "#shared/recovery.ts";
import type { LegacyRequesterListSchema } from "#shared/recovery-claims.ts";
import {
  ALEX,
  KIDS,
  MEMBER,
  OWNER,
  type Persona,
} from "#testing/fixture-api/personas.ts";
import {
  FixtureFailure,
  type FixtureScenario,
} from "#testing/fixture-api/scenario.ts";
import {
  DAY,
  HOUR,
  MINUTE,
  ago,
  ahead,
  fixtureId,
  pick,
  sha256,
} from "#testing/fixture-api/support.ts";
import { migrationProposals } from "#testing/fixture-api/fixtures/owner.ts";
import {
  TITLES,
  episodeId,
  titleNamed,
} from "#testing/fixture-api/fixtures/titles.ts";

type RecoveryList = z.input<typeof RecoveryListSchema>;
type RecoveryDetail = z.input<typeof RecoveryDetailSchema>;
type LegacyRequesters = z.input<typeof LegacyRequesterListSchema>;

/**
 * The reasons a title is held, as the server writes them: one for a restore,
 * two for old-system requests that are not yet matched to a person.
 */
const HOLD_REASONS = [
  "recovery_request_history_unconfirmed",
  "legacy_claim_reconciliation_required",
  "migration_household_intent_review_required",
];
const HELD_TITLES = [
  "Blade Runner 2049",
  "The Wire",
  "Interstellar",
  "Cowboy Bebop",
  "Succession",
  "Alien",
];

/** The reviews every household has: one open, two applied. */
const REVIEW_TITLES = [
  {
    state: "awaiting_responses",
    days: 2,
    titles: ["Breaking Bad", "Better Call Saul"],
  },
  { state: "released", days: 6, titles: ["The Godfather"] },
  { state: "released", days: 19, titles: ["Chernobyl", "Fleabag", "Dark"] },
] as const;

const OLDER_REVIEWS = [
  "Oppenheimer",
  "Parasite",
  "Arrival",
  "Heat",
  "Whiplash",
  "Moonlight",
  "Spotlight",
  "Roma",
];

function reviewRow(
  sequence: number,
  state: string,
  days: number,
  titles: readonly string[],
) {
  return {
    id: fixtureId(16, sequence),
    state,
    createdAt: ago(days * DAY),
    titles: [...titles],
  };
}

/**
 * What a restore left. Only the owner is told which titles are held and what
 * the runtime may do; a member sees the reviews they can answer.
 */
export function recoveryList(
  persona: Persona,
  scenario: FixtureScenario,
): RecoveryList {
  if (scenario === "recovery-unavailable") {
    throw new FixtureFailure(
      500,
      "internal_error",
      "The recovery reviews could not be read",
    );
  }
  const authority =
    persona === "owner"
      ? {
          mode: "observe" as const,
          ownershipConfirmed: false,
          writerState: "revoked" as const,
          storageState: "current" as const,
        }
      : null;
  const reviews = REVIEW_TITLES.map((row, index) =>
    reviewRow(index + 1, row.state, row.days, row.titles),
  );
  if (scenario === "new-household") {
    return { authority, holds: [], reviews: [] };
  }
  if (scenario === "recovery-all-clear") {
    return {
      authority,
      holds: [],
      reviews: reviews.filter((review) => review.state === "released"),
    };
  }
  if (scenario === "recovery-long") {
    const held = TITLES.slice(0, 42).map((title, index) => ({
      mediaId: title.id,
      title: title.title,
      reason: pick(HOLD_REASONS, Math.floor(index / 15)),
    }));
    return {
      authority,
      holds: persona === "owner" ? held : [],
      reviews: [
        reviewRow(4, "awaiting_responses", 1, ["Dark"]),
        reviewRow(5, "awaiting_responses", 3, ["Succession", "The Wire"]),
        ...reviews,
        ...OLDER_REVIEWS.map((title, index) =>
          reviewRow(10 + index, "released", 25 + index * 3, [title]),
        ),
      ],
    };
  }
  return {
    authority,
    holds:
      persona === "owner"
        ? HELD_TITLES.map((title, index) => ({
            mediaId: titleNamed(title).id,
            title,
            reason: pick(HOLD_REASONS, index),
          }))
        : [],
    reviews,
  };
}

export const MACHINE = "fixture-server";

export type Subject = (typeof SUBJECTS)[number];
export const SUBJECTS = [
  { user: OWNER, authority: "self", mapping: "account", home: null },
  { user: MEMBER, authority: "self", mapping: "account", home: null },
  { user: KIDS, authority: "managed_owner", mapping: "managed", home: "7" },
] as const;

export function claimIdentity(sequence: number) {
  return {
    provenanceKey: sha256(`claim-provenance-${String(sequence)}`),
    captureHash: sha256("capture-2"),
    recordDigest: sha256(`claim-record-${String(sequence)}`),
    bindingId: fixtureId(21, sequence),
    bindingRevision: 1,
    latestBindingRevision: 1,
  };
}

export function recoverySubject(
  row: Subject,
  mediaIds: readonly string[],
  claims: number,
) {
  return {
    id: row.user.id,
    displayName: row.user.displayName,
    plexAccountId: row.user.plexAccountId,
    version: row.user.version,
    restricted: row.user.restricted,
    role: row.user.role,
    mappingVersion: 4,
    mappingKind: row.mapping,
    serverMachineId: MACHINE,
    permittedSectionIds: ["1", "2"],
    permittedMediaKinds: ["movie", "series"],
    plexRestricted: false,
    declarationAuthority: row.authority,
    applicableMediaIds: [...mediaIds],
    claimAcknowledgements: Array.from({ length: claims }, (_, index) => ({
      ...claimIdentity(index + 1),
      mediaIds: mediaIds.slice(0, 2),
    })),
    homeUserId: row.home,
    serverAccountId: row.home === null ? row.user.plexAccountId : "31",
  };
}

type Leaf = { id: string; title: string };

function whole(names: readonly string[]): Leaf[] {
  return names.map((name) => {
    const title = titleNamed(name);
    return { id: title.id, title: title.title };
  });
}

/** What a review covers: whole titles, or the episodes of one series. */
function leaves(sequence: number): Leaf[] {
  switch (sequence) {
    case 1: {
      return whole(["Breaking Bad", "Better Call Saul"]);
    }
    case 2: {
      return whole(["The Godfather"]);
    }
    case 3: {
      return whole(["Chernobyl", "Fleabag", "Dark"]);
    }
    case 4: {
      const dark = titleNamed("Dark");
      return dark.seasons.flatMap((count, season) =>
        Array.from({ length: count }, (_, episode) => ({
          id: episodeId(dark, season + 1, episode + 1),
          title: `Dark S${String(season + 1)}E${String(episode + 1).padStart(2, "0")}`,
        })),
      );
    }
    default: {
      return whole(["Succession", "The Wire"]);
    }
  }
}

function mediaRow(leaf: Leaf) {
  return {
    id: leaf.id,
    title: leaf.title,
    kind: "movie",
    sectionId: "1",
    version: 2,
    generation: 3,
    automationEpoch: 1,
  };
}

/**
 * Review `sequence` as `persona` reads it. The owner reads the whole
 * household's scope; a member reads only their own titles and declaration.
 * Review 1 has the owner already declared, a managed profile still to
 * declare for, and a member who has not answered; 4 is the long one, 5
 * cannot be applied, and 6 has every declaration and is ready to apply.
 */
export function recoveryDetail(
  persona: Persona,
  id: string,
): RecoveryDetail | null {
  const sequence = [1, 2, 3, 4, 5, 6].find((n) => fixtureId(16, n) === id);
  if (sequence === undefined) return null;
  const released = sequence === 2 || sequence === 3;
  const blocked = sequence === 5;
  const covered = leaves(sequence);
  const mediaIds = covered.map((leaf) => leaf.id);
  const owner = persona === "owner";
  const everyone: readonly Subject[] = SUBJECTS;
  const visible = owner
    ? everyone
    : everyone.filter((row) => row.user.id === MEMBER.id);
  const scopeHash = sha256(`review-${String(sequence)}`);
  const declared = (row: Subject) =>
    released || sequence === 6 || (sequence === 1 && row.user.id === OWNER.id);
  const responses = visible
    .filter((row) => declared(row))
    .map((row, index) => ({
      userId: row.user.id,
      actorId: OWNER.id,
      createdAt: ago((index + 1) * HOUR),
      response: {
        schemaVersion: 2 as const,
        scopeHash,
        subjectUserId: row.user.id,
        claimAcknowledgements: [],
        acknowledgePending: true as const,
        declarations: covered.map((leaf, position) => {
          const mediaId = leaf.id;
          switch (position % 3) {
            case 0: {
              return { mediaId, intent: "request" as const };
            }
            case 1: {
              return { mediaId, intent: "keep" as const, days: 30 };
            }
            default: {
              return { mediaId, intent: "no_longer_request" as const };
            }
          }
        }),
        authority: {
          mode: row.authority,
          actorId: OWNER.id,
          actorVersion: OWNER.version,
          subjectUserId: row.user.id,
          mappingVersion: 4,
        },
      },
    }));
  const roster = visible.map((row) =>
    recoverySubject(row, mediaIds, owner && sequence === 4 ? 2 : 0),
  );
  return {
    id,
    state: released ? "released" : "awaiting_responses",
    version: released ? 6 : 2,
    scopeHash,
    responseHash:
      released || sequence === 1 || sequence === 6
        ? sha256(`responses-${String(sequence)}`)
        : null,
    expiresAt: released ? ago(DAY) : ahead(5 * DAY),
    scope: {
      schemaVersion: 2,
      excludedUsers: owner
        ? [
            {
              id: ALEX.id,
              displayName: ALEX.displayName,
              version: ALEX.version,
              mappingVersion: 2,
              reason: "fresh_scope_denial_without_relevant_claim",
            },
          ]
        : [],
      recoveryEpoch: 1,
      runtimeVersion: 12,
      media: covered.map((leaf) => mediaRow(leaf)),
      holds: covered.map((leaf) => ({
        mediaId: leaf.id,
        version: 1,
        recoveryEpoch: 1,
        reason: "recovery_request_history_unconfirmed",
        createdAt: ago(9 * DAY),
      })),
      users: roster,
      householdRoster: owner ? roster : [],
      assets: [],
      requests: [],
      coverage: [],
      personalHolds: visible.slice(0, 2).map((row, index) => ({
        userId: row.user.id,
        mediaId: pick(mediaIds, index),
        isPin: index === 0,
        until: index === 0 ? null : ahead(12 * DAY),
      })),
      handoffReceipts: [],
      nativeReceipts: [],
      blockers: blocked ? ["shared_coverage_incomplete"] : [],
      excludedPairs: owner
        ? [
            {
              userId: MEMBER.id,
              mediaId: pick(mediaIds, 1),
              reason: "fresh_scope_denial_without_relevant_claim",
            },
          ]
        : [],
      legacyClaims:
        owner && sequence === 4
          ? [0, 1].map((index) => ({
              ...claimIdentity(index + 1),
              captureId: fixtureId(17, 102),
              sourceKind:
                index === 0 ? ("radarr" as const) : ("sonarr" as const),
              sourceInstanceId: sha256("instance-sonarr"),
              requesterSourceId: `u-100${String(index + 1)}`,
              userId: MEMBER.id,
              mediaIds: mediaIds.slice(index * 10, index * 10 + 8),
              outsideMediaIds: [fixtureId(4, 900 + index)],
              sourceScope:
                index === 0 ? ("season" as const) : ("series" as const),
              seasons: index === 0 ? [1, 2] : [],
            }))
          : [],
    },
    responses,
    missingUserIds: visible
      .filter((row) => !declared(row))
      .map((row) => row.user.id),
    receiptId: released ? fixtureId(22, sequence) : null,
  };
}

function identity(row: Subject, eligible: boolean) {
  return {
    userId: row.user.id,
    displayName: row.user.displayName,
    identity: {
      userId: row.user.id,
      userVersion: row.user.version,
      plexAccountId: row.user.plexAccountId,
      kind:
        row.mapping === "managed" ? ("managed" as const) : ("account" as const),
      version: 4,
      serverMachineId: MACHINE,
      serverAccountId: row.home === null ? row.user.plexAccountId : "31",
      homeUserId: row.home,
      permittedSectionIds: ["1"],
      permittedMediaKinds: ["movie", "series"],
      restricted: false,
      plexRestricted: !eligible,
    },
    eligible,
  };
}

/** The requesters of the uploaded capture `captureId`, matched and not yet. */
export function legacyRequesters(captureId: string): LegacyRequesters | null {
  const capture = migrationProposals().find(
    (proposal) => proposal.captureId === captureId,
  );
  if (capture === undefined) return null;
  const matched = SUBJECTS[1];
  const targets = [
    identity(SUBJECTS[0], true),
    identity(matched, true),
    identity(SUBJECTS[2], true),
    {
      ...identity(
        { user: ALEX, authority: "self", mapping: "account", home: null },
        false,
      ),
    },
  ];
  const requester = (name: string, count: number, bound: boolean) => ({
    requesterSourceId: name,
    requesterEvidenceHash: sha256(`requester-${name}`),
    requestCount: count,
    latestRevision: bound ? 1 : 0,
    binding: bound
      ? {
          id: fixtureId(21, 90),
          sourceKind: capture.source.kind,
          sourceInstanceId: capture.source.instanceId,
          requesterSourceId: name,
          captureId,
          captureHash: capture.captureHash,
          requesterEvidenceHash: sha256(`requester-${name}`),
          userId: matched.user.id,
          identitySnapshot: identity(matched, true).identity,
          actorId: OWNER.id,
          revision: 1,
          previousId: null,
          createdAt: ago(3 * DAY + 5 * MINUTE),
          provenance: "owner_declared_identity_only" as const,
        }
      : null,
  });
  return {
    captureId,
    captureHash: capture.captureHash,
    sourceKind: capture.source.kind,
    sourceInstanceId: capture.source.instanceId,
    requesters: [
      requester("u-1001", 14, false),
      requester("u-1002", 6, true),
      requester("u-1003", 31, false),
    ],
    targets,
  };
}
