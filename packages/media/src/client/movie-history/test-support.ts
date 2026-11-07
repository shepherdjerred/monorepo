import { UserSchema } from "#shared/contract.ts";
import { MovieHistoryPersonalDetailV3Schema } from "#shared/movie-editions/history-review-v3.ts";

/** Synthetic browser DTO only: no database history, consent or physical authority is created. */
export function movieHistoryPersonalFixtureV3() {
  const user = UserSchema.parse({
    id: crypto.randomUUID(),
    plexAccountId: "710002",
    displayName: "Synthetic member",
    role: "member",
    restricted: false,
    version: 2,
  });
  const mediaId = crypto.randomUUID();
  const scope = { rootMediaId: mediaId, mediaId, edition: "directors_cut" };
  const requestId = crypto.randomUUID();
  const choiceId = crypto.randomUUID();
  const at = "2026-10-28T00:00:00.000Z";
  const review = MovieHistoryPersonalDetailV3Schema.parse({
    id: crypto.randomUUID(),
    state: "awaiting_responses",
    version: 3,
    scopeHash: "a".repeat(64),
    expiresAt: "2099-01-01T00:00:00.000Z",
    scope,
    definition: { definitionVersion: 0, definitionDigest: "b".repeat(64) },
    registryVersion: 1,
    title: "Synthetic scoped review",
    subject: {
      id: user.id,
      displayName: user.displayName,
      plexAccountId: user.plexAccountId,
      version: user.version,
      restricted: false,
      role: "member",
      mappingVersion: 4,
      mappingKind: "account",
      serverMachineId: "fixture-server",
      permittedSectionIds: ["1"],
      permittedMediaKinds: ["movie"],
      plexRestricted: false,
      declarationAuthority: "self",
      applicableMediaIds: [mediaId],
      homeUserId: null,
      serverAccountId: "710002",
      claimAcknowledgements: [
        {
          provenanceKey: "c".repeat(64),
          captureHash: "d".repeat(64),
          recordDigest: "e".repeat(64),
          bindingId: crypto.randomUUID(),
          bindingRevision: 1,
          latestBindingRevision: 1,
          mediaIds: [mediaId],
        },
      ],
    },
    requests: [
      {
        id: requestId,
        userId: user.id,
        mediaId,
        edition: "directors_cut",
        version: 7,
        active: true,
        excluded: false,
        direct: true,
        movieEditionChoiceId: choiceId,
        movieEditionChoiceRevision: 2,
        subtitleLanguages: ["zh-Hans", "en"],
        createdAt: at,
        updatedAt: at,
      },
    ],
    choices: [
      {
        id: choiceId,
        requestId,
        choiceRevision: 2,
        actorId: user.id,
        subjectUserId: user.id,
        rootMediaId: mediaId,
        edition: "directors_cut",
        definitionVersion: 0,
        registryVersion: 1,
        requestVersionAtChoice: 7,
        authority: {
          schemaVersion: 1,
          mode: "self",
          actorVersion: 2,
          subjectVersion: 2,
          mappingVersion: 4,
          serverMachineId: "fixture-server",
          homeUserId: null,
          serverAccountId: "710002",
        },
        createdAt: at,
      },
    ],
    personalHolds: [
      {
        id: crypto.randomUUID(),
        userId: user.id,
        mediaId,
        edition: "directors_cut",
        until: "2099-02-01T00:00:00.000Z",
        isPin: false,
        createdAt: at,
      },
    ],
    response: null,
  });
  return { user, review };
}
