import { expect, test } from "vitest";
import type { ReleaseCandidate } from "#generated/prisma/client.ts";
import { candidateDigest } from "#infrastructure/acquisition-identity/snapshot.ts";
import { releaseCut } from "./cut-context.ts";

const historical: ReleaseCandidate = {
  id: "00000000-0000-4000-8000-000000000001",
  providerId: "knaben",
  providerReleaseId: "original-1",
  title: "Example.Show.S01E01.1080p.WEB-DL",
  attributes: { quality: "web-1080p" },
  evaluation: {},
  encryptedSource: null,
  mediaIds: [],
  searchedForMediaIds: [],
  sourceEvidence: { infoHash: "a".repeat(40) },
  createdAt: new Date("2026-01-01T00:00:00Z"),
};
const canonical = {
  rootMediaId: "series-1",
  title: "Example Show",
  aliases: [],
  digest: "b".repeat(64),
};

test("historical source digest remains literal and cut projection does not inject attribution", () => {
  const before = JSON.stringify(historical);
  expect(candidateDigest(historical)).toBe(
    "4cef6a7743c1a1376792971c257b317e3815df9be2012edd9c4bdbe2cd060780",
  );
  expect(releaseCut(historical, canonical)).toMatchObject({
    attribution: "legacy_primary",
    conclusion: { kind: "standard_unmarked" },
  });
  expect(JSON.stringify(historical)).toBe(before);
});

test.each([
  { editionEvidence: [] },
  {
    editionEvidence: [
      {
        text: historical.title,
        provenance: { kind: "release-title", field: "secondary" },
      },
    ],
  },
])(
  "secondary attribution cannot hide a named immutable primary",
  ({ editionEvidence }) => {
    const release = {
      ...historical,
      title: "Example.Show.S01E01.Extended.Cut.1080p",
      sourceEvidence: { infoHash: "a".repeat(40), editionEvidence },
    };
    expect(releaseCut(release, canonical).conclusion).toEqual({
      kind: "named",
      cut: "extended_cut",
    });
  },
);

test("all conflicting real title fields participate", () => {
  const release = {
    ...historical,
    title: "Example.Show.S01E01.Extended.Cut.1080p",
    sourceEvidence: {
      infoHash: "a".repeat(40),
      editionEvidence: [
        {
          text: "Example.Show.S01E01.Directors.Cut.1080p",
          provenance: { kind: "release-title", field: "file_name" },
        },
      ],
    },
  };
  expect(releaseCut(release, canonical).conclusion.kind).toBe("conflict");
});
