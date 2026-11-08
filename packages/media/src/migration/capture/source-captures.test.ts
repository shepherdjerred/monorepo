import { expect, test } from "vitest";
import { captureSeerr } from "./seerr-capture.ts";
import { captureBazarr } from "./bazarr-capture.ts";
import { validateCapture } from "./capture-validation.ts";
import { normalizeCapture } from "#migration/normalize.ts";
import compatibility from "#migration/fixtures/capture-compatibility.json" with { type: "json" };

const source = {
  sourceInstanceId: "a".repeat(64),
  baseUrl: "http://127.0.0.1:1234",
  apiKey: "synthetic-private-key",
};
function fetcher(reply: (url: URL) => unknown): typeof fetch {
  return Object.assign(
    async (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => {
      expect(init?.method).toBe("GET");
      return Response.json(
        reply(new URL(input instanceof Request ? input.url : input)),
      );
    },
    {
      preconnect() {
        /* Fixture has no network. */
      },
    },
  );
}
function seerrReply(url: URL) {
  if (url.pathname.endsWith("status"))
    return { version: compatibility.seerr.version };
  if (url.pathname.endsWith("auth/me"))
    return { permissions: 2, email: "owner-private@example.invalid" };
  return {
    pageInfo: { results: 1, page: 1 },
    results: [
      {
        id: 4,
        type: "tv",
        status: 2,
        media: { tmdbId: 45, tvdbId: 46 },
        requestedBy: {
          id: 17,
          plexId: 17,
          email: "requester-private@example.invalid",
          displayName: "Owner",
        },
        seasons: [
          { seasonNumber: 1, status: 2 },
          { seasonNumber: 2, status: 3 },
        ],
      },
    ],
  };
}
test("Seerr source users are never inferred as Plex accounts; season coverage and secrets are preserved safely", async () => {
  const capture = await captureSeerr(
    { ...source, source: "seerr" },
    fetcher(seerrReply),
  );
  expect(validateCapture(capture)).toMatchObject({
    complete: true,
    stable: true,
  });
  expect(capture.records).toMatchObject([
    {
      requesterSourceId: "17",
      plexAccountId: null,
      requesterMappingEvidenceHash: null,
      scope: "season",
      seasons: [1],
    },
  ]);
  expect(JSON.stringify(capture)).not.toContain("private");
  expect(
    normalizeCapture(capture, { targets: [] }).entries[0]?.reasons,
  ).toContain("requester_unmapped");
});
test("restricted Seerr inventory and changing page totals cannot claim completeness", async () => {
  const restricted = await captureSeerr(
    { ...source, source: "overseerr" },
    fetcher((url) =>
      url.pathname.endsWith("auth/me") ? { permissions: 32 } : seerrReply(url),
    ),
  );
  expect(validateCapture(restricted).complete).toBe(false);
  const incomplete = await captureSeerr(
    { ...source, source: "jellyseerr" },
    fetcher((url) =>
      url.pathname.endsWith("request")
        ? { ...seerrReply(url), pageInfo: { results: 101, page: 1 } }
        : seerrReply(url),
    ),
  );
  expect(validateCapture(incomplete).complete).toBe(false);
});
function bazarrReply(url: URL) {
  if (url.pathname.endsWith("status"))
    return {
      data: {
        bazarr_version: compatibility.bazarr.version,
        directory: "/private/config",
      },
    };
  if (url.pathname.endsWith("profiles"))
    return [
      {
        profileId: 1,
        name: "Private label",
        cutoff: 65_535,
        items: [
          {
            id: 1,
            language: "en",
            forced: "False",
            hi: "Excluded",
            audio_exclude: "True",
            audio_only_include: "False",
          },
        ],
        originalFormat: 1,
        mustContain: ["private-rule"],
        mustNotContain: [],
      },
    ];
  if (url.pathname.endsWith("movies"))
    return {
      total: 1,
      data: [
        {
          radarrId: 42,
          profileId: 1,
          subtitles: [
            {
              id: 7,
              code2: "en",
              code3: "eng",
              path: null,
              forced: false,
              hi: false,
              embedded_track_id: 2,
            },
          ],
        },
      ],
    };
  return { total: 0, data: [] };
}
test("Bazarr profiles keep per-language semantics and embedded provenance but never infer the manager instance", async () => {
  const capture = await captureBazarr(source, fetcher(bazarrReply));
  expect(validateCapture(capture)).toMatchObject({
    complete: true,
    stable: true,
  });
  expect(capture.records).toMatchObject([
    {
      kind: "subtitle_preference",
      sourceProfile: {
        cutoff: 65_535,
        hasConstraints: true,
        items: [{ hi: "Excluded", audio_exclude: "True" }],
      },
      managerReference: { sourceMediaId: "42", sourceInstanceId: null },
    },
    {
      kind: "subtitle",
      path: null,
      embeddedTrackId: 2,
      provenance: "embedded",
    },
  ]);
  expect(JSON.stringify(capture)).not.toContain("private");
  expect(
    normalizeCapture(capture, { targets: [] }).entries.every(
      (entry) => entry.state === "protected",
    ),
  ).toBe(true);
});
test("missing Bazarr profile protects inventory instead of inventing defaults", async () => {
  const capture = await captureBazarr(
    source,
    fetcher((url) =>
      url.pathname.endsWith("profiles") ? [] : bazarrReply(url),
    ),
  );
  expect(validateCapture(capture).complete).toBe(false);
});
