import { afterEach, expect, test, vi } from "vitest";
import {
  associationFixture,
  page,
} from "#automation/publication/association/test-fixture.ts";
import {
  MovieEditionKeySchema,
  MOVIE_EDITION_REGISTRY,
  type MovieEditionKey,
} from "#shared/movie-editions/registry.ts";
import { PlexBindingExpectedSchema } from "#shared/plex-binding/expected.ts";
import { PlexCanonicalTargetSchema } from "#shared/plex-binding/canonical.ts";
import { PlexAssociationV1Schema } from "#shared/plex-binding/contract.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { verifyMoviePlexV2 } from "./plex-verification.ts";
import { observeAssociatedWatch } from "#automation/plex-events/metadata.ts";

afterEach(() => vi.restoreAllMocks());

test("watch state belongs to the exact observed edition and becomes unknown after its label changes", async () => {
  const f = fixture();
  const plex = f.createClient();
  const verified = await verifyMoviePlexV2({ plex }, f.input, f.execution);
  if ("status" in verified)
    throw new Error("Movie Plex watch fixture failed verification");
  const context = {
    plex,
    execution: f.execution,
    freshness: verified.freshness,
  };
  f.item.viewCount = 1;
  expect(await observeAssociatedWatch(context, verified.associations[0])).toBe(
    true,
  );
  f.item.editionTitle = "Theatrical Cut";
  expect(
    await observeAssociatedWatch(context, verified.associations[0]),
  ).toBeNull();
});

function fixture(edition: MovieEditionKey = "extended_cut") {
  const f = associationFixture();
  const coverage = f.input.expected.targets.map((row) => ({
    ...row.scope,
    edition,
  }));
  f.input.expected = PlexBindingExpectedSchema.parse({
    ...f.input.expected,
    targets: f.input.expected.targets.map((row) => ({
      ...row,
      scope: { ...row.scope, edition },
      definition: { ...row.definition, key: edition },
    })),
    previous: f.input.expected.previous.map((row) => ({
      ...row,
      scope: { ...row.scope, edition },
    })),
    newGroups: f.input.expected.newGroups.map((row) => ({
      ...row,
      edition,
      coverage,
      coverageHash: snapshotHash(coverage),
    })),
  });
  f.input.canonicalTargets = f.input.canonicalTargets.map((row) =>
    PlexCanonicalTargetSchema.parse({
      ...row,
      scope: { ...row.scope, edition },
    }),
  );
  const item = f.items[0];
  if (item === undefined) throw new Error("Movie Plex fixture missing");
  const label = MOVIE_EDITION_REGISTRY[edition].plexLabel;
  if (label !== "") item.editionTitle = label;
  return { ...f, item };
}

test.each(MovieEditionKeySchema.options)(
  "two complete actual HTTP passes bind exact %s edition metadata and Part",
  async (edition) => {
    const f = fixture(edition);
    const result = await verifyMoviePlexV2(
      { plex: f.createClient() },
      f.input,
      f.execution,
    );
    expect(result).toMatchObject({
      schemaVersion: 2,
      purpose: "current_serving",
      associations: [
        {
          schemaVersion: 2,
          scope: { edition },
          item: {
            editionTitle: MOVIE_EDITION_REGISTRY[edition].plexLabel || null,
            media: [
              {
                parts: [
                  {
                    id: "500",
                    file: "/data/movies/Synthetic.mkv",
                    sizeBytes: "128",
                  },
                ],
              },
            ],
          },
        },
      ],
    });
    if ("status" in result)
      throw new Error("Actual synthetic Plex response rejected");
    expect(result.verification.passes[0]).toEqual(
      result.verification.passes[1],
    );
    expect(
      PlexAssociationV1Schema.safeParse(result.associations[0]).success,
    ).toBe(false);
    expect(f.calls.filter((url) => url.pathname.endsWith("/all"))).toHaveLength(
      2,
    );
    expect(
      f.calls.filter((url) => url.pathname.startsWith("/library/metadata/")),
    ).toHaveLength(2);
  },
);

test.each([undefined, "Theatrical Cut", "DC", "Extended", "Extended Cut "])(
  "matching movie/file with edition %s does not prove the requested Extended Cut",
  async (editionTitle) => {
    const f = fixture();
    if (editionTitle === undefined) delete f.item.editionTitle;
    else f.item.editionTitle = editionTitle;
    await expect(
      verifyMoviePlexV2({ plex: f.createClient() }, f.input, f.execution),
    ).resolves.toEqual({ status: "protected", reason: "metadata_changed" });
  },
);

test("unmarked requests reject a named Plex item even when identity and bytes match", async () => {
  const f = fixture("default");
  f.item.editionTitle = "Theatrical Cut";
  await expect(
    verifyMoviePlexV2({ plex: f.createClient() }, f.input, f.execution),
  ).resolves.toEqual({ status: "protected", reason: "metadata_changed" });
});

test("another cut can coexist with the same movie GUID while its rating key and Part remain separate", async () => {
  const f = fixture();
  f.items.push({
    ...f.item,
    ratingKey: "11",
    editionTitle: "Theatrical Cut",
    Media: [{ Part: [{ id: 501, file: "/data/movies/Other.mkv", size: 128 }] }],
  });
  await expect(
    verifyMoviePlexV2({ plex: f.createClient() }, f.input, f.execution),
  ).resolves.toMatchObject({
    associations: [
      {
        scope: { edition: "extended_cut" },
        item: { ratingKey: "10", editionTitle: "Extended Cut" },
      },
    ],
  });
});

test("an edition label that changes between metadata and inventory invalidates the observation", async () => {
  const f = fixture();
  const plex = f.createClient((url) =>
    url.pathname === "/library/metadata/10"
      ? Response.json({
          MediaContainer: {
            size: 1,
            Metadata: [{ ...f.item, editionTitle: "Theatrical Cut" }],
          },
        })
      : undefined,
  );
  await expect(
    verifyMoviePlexV2({ plex }, f.input, f.execution),
  ).resolves.toEqual({ status: "protected", reason: "metadata_changed" });
});

test.each(["duplicate-part", "duplicate-path", "merged-media", "incomplete"])(
  "%s cannot supply edition authority",
  async (failure) => {
    const f = fixture();
    if (failure === "duplicate-part" || failure === "duplicate-path")
      f.items.push({
        ...f.item,
        ratingKey: "11",
        Media: [
          {
            Part: [
              {
                id: failure === "duplicate-part" ? 500 : 501,
                file:
                  failure === "duplicate-path"
                    ? "/data/movies/Synthetic.mkv"
                    : "/data/movies/Other.mkv",
              },
            ],
          },
        ],
      });
    if (failure === "merged-media")
      f.item.Media?.push({
        Part: [{ id: 501, file: "/data/movies/Other.mkv" }],
      });
    const plex = f.createClient((url) =>
      failure === "incomplete" && url.pathname.endsWith("/all")
        ? page(f.items, 10_001)
        : undefined,
    );
    await expect(
      verifyMoviePlexV2({ plex }, f.input, f.execution),
    ).resolves.toMatchObject({ status: "protected" });
  },
);

test("edition verification retains the original execution observation and expiry", async () => {
  const f = fixture();
  const original = { ...f.input.observed };
  const plex = f.createClient((url) => {
    if (url.pathname === "/library/metadata/10")
      vi.spyOn(Date, "now").mockReturnValue(f.input.expiresAtMs + 1);
    return;
  });
  await expect(
    verifyMoviePlexV2({ plex }, f.input, f.execution),
  ).resolves.toMatchObject({
    status: "protected",
    reason: "verification_expired",
  });
  expect(f.input.observed).toEqual(original);
});
