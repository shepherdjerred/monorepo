import { describe, expect, it } from "vitest";
import {
  MovieRequestV3Schema,
  CancelMovieRequestV3Schema,
} from "./commands.ts";
import {
  movieEditionDefinition,
  MovieEditionDefinitionSchema,
} from "./registry.ts";
import { MovieEditionRequestViewSchema } from "./view.ts";
import { MovieEditionFulfillmentSchema } from "./fulfillment.ts";
import {
  MovieLibraryReferenceV2Schema,
  MoviePassiveLibraryReferenceV1Schema,
  MoviePublicationReferenceV2Schema,
} from "./publication-v2.ts";
import {
  LibraryAssetReferenceV1Schema,
  PassiveLibraryAssetReferenceV1Schema,
  LibraryAssetReferenceProtocolSchema,
} from "#shared/handoff/library-ownership.ts";

const mediaId = "10000000-0000-4000-8000-000000000001";
const subjectUserId = "10000000-0000-4000-8000-000000000002";
const requestId = "10000000-0000-4000-8000-000000000003";
const scope = { rootMediaId: mediaId, mediaId, edition: "default" };
const request = {
  schemaVersion: 3,
  mediaId,
  subjectUserId,
  expected: {
    mediaVersion: 0,
    targetVersion: null,
    definition: null,
    request: null,
  },
  selection: {
    edition: "default",
    definitionVersion: 0,
    definitionDigest: "a".repeat(64),
    registryVersion: 1,
  },
  options: { subtitleLanguages: ["en"] },
};

describe("explicit movie edition boundary", () => {
  it("requires an explicit selection without inventing authority from absence", () => {
    expect(MovieRequestV3Schema.parse(request)).toEqual(request);
    const { selection: _selection, ...unselected } = request;
    expect(MovieRequestV3Schema.safeParse(unselected).success).toBe(false);
    expect(
      MovieRequestV3Schema.safeParse({
        ...request,
        selection: { ...request.selection, edition: "imax" },
      }).success,
    ).toBe(false);
    expect(
      MovieRequestV3Schema.safeParse({ ...request, grantId: requestId })
        .success,
    ).toBe(false);
  });

  it("keeps unmarked distinct from theatrical and refuses registry relabeling", () => {
    const unmarked = movieEditionDefinition(mediaId, "default");
    expect(unmarked).toEqual({
      rootMediaId: mediaId,
      key: "default",
      policy: "standard_unmarked",
      pathLabel: "",
      plexLabel: "",
      definitionVersion: 0,
    });
    expect(movieEditionDefinition(mediaId, "theatrical_cut").policy).toBe(
      "theatrical_cut",
    );
    expect(
      MovieEditionDefinitionSchema.safeParse({
        ...unmarked,
        policy: "theatrical_cut",
      }).success,
    ).toBe(false);
    expect(
      MovieEditionDefinitionSchema.safeParse({
        ...unmarked,
        definitionVersion: 1,
      }).success,
    ).toBe(false);
  });

  it("requires exact request and semantic choice CAS for cancellation", () => {
    const input = {
      schemaVersion: 3,
      subjectUserId,
      scope,
      requestId,
      expected: { targetVersion: 4, requestVersion: 5, choiceRevision: 2 },
      action: "cancel_request",
    };
    expect(CancelMovieRequestV3Schema.parse(input)).toEqual(input);
    expect(
      CancelMovieRequestV3Schema.safeParse({
        ...input,
        expected: { targetVersion: 4, requestVersion: 5 },
      }).success,
    ).toBe(false);
    expect(
      CancelMovieRequestV3Schema.safeParse({
        ...input,
        scope: { ...scope, rootMediaId: subjectUserId },
      }).success,
    ).toBe(false);
  });

  it("keeps pending fulfillment and protection-only reads free of playable metadata", () => {
    const row = {
      access: "protection_only",
      requestId,
      scope,
      active: true,
      targetVersion: 0,
      requestVersion: 1,
      choiceRevision: 0,
      choiceId: null,
      fulfillment: {
        status: "pending_choice",
        reason: "movie_edition_choice_required",
      },
      canCancel: true,
      canRevokeChoice: false,
    };
    expect(MovieEditionRequestViewSchema.parse(row)).toEqual(row);
    expect(
      MovieEditionRequestViewSchema.safeParse({ ...row, title: "Hidden movie" })
        .success,
    ).toBe(false);
    expect(
      MovieEditionFulfillmentSchema.safeParse({
        status: "fulfilled",
        reason: "movie_edition_choice_required",
      }).success,
    ).toBe(false);
  });
});

describe("literal library parent reference versions", () => {
  const fields = {
    receiptId: requestId,
    planId: subjectUserId,
    planHash: "a".repeat(64),
    assetId: mediaId,
    assetVersion: 0,
    bindingHash: "b".repeat(64),
    physicalEvidenceHash: "c".repeat(64),
  };
  it.each([
    {
      label: "movie",
      historical: MovieLibraryReferenceV2Schema,
      passive: MoviePassiveLibraryReferenceV1Schema,
      protocol: MoviePublicationReferenceV2Schema,
      reference: { kind: "movie_library_adoption_v2", scope, ...fields },
    },
    {
      label: "library",
      historical: LibraryAssetReferenceV1Schema,
      passive: PassiveLibraryAssetReferenceV1Schema,
      protocol: LibraryAssetReferenceProtocolSchema,
      reference: { kind: "library_adoption_v1", ...fields },
    },
  ])(
    "keeps $label version-zero literal and version-one a separate strict branch",
    ({ historical, passive, protocol, reference }) => {
      expect(historical.parse(reference)).toEqual(reference);
      expect(protocol.parse(reference)).toEqual(reference);
      const registered = { ...reference, assetVersion: 1 };
      expect(historical.safeParse(registered).success).toBe(false);
      expect(passive.safeParse(reference).success).toBe(false);
      expect(passive.parse(registered)).toEqual(registered);
      expect(protocol.parse(registered)).toEqual(registered);
      for (const assetVersion of [-1, 2, 1.5, null, "1"])
        expect(protocol.safeParse({ ...reference, assetVersion }).success).toBe(
          false,
        );
      const { assetVersion: _version, ...missing } = reference;
      expect(protocol.safeParse(missing).success).toBe(false);
      expect(
        protocol.safeParse({ ...registered, registrationApproved: true })
          .success,
      ).toBe(false);
      expect(
        protocol.safeParse({ ...registered, planHash: "unbound" }).success,
      ).toBe(false);
      expect(
        protocol.safeParse({ ...registered, receiptId: "absent" }).success,
      ).toBe(false);
    },
  );
});
