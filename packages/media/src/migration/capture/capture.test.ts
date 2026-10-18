import { expect, test } from "vitest";
import { captureManager } from "./manager-capture.ts";
import { normalizeCapture } from "#migration/normalize.ts";
import { compareCaptures } from "#migration/delta.ts";
import { recordDigest, validateCapture } from "./capture-validation.ts";

function source() {
  return {
    source: "radarr" as const,
    sourceInstanceId: "a".repeat(64),
    baseUrl: "http://127.0.0.1:7878",
    apiKey: "synthetic-secret",
  };
}
function fetcher(change = false): typeof fetch {
  let movies = 0;
  return Object.assign(
    async (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => {
      expect(init?.method).toBe("GET");
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.pathname.endsWith("system/status"))
        return Response.json({ version: "6.4.4", apiKey: "must-not-persist" });
      if (url.pathname.endsWith("movie"))
        return Response.json([
          {
            id: 1,
            tmdbId: change && ++movies === 2 ? 999 : 10,
            qualityProfileId: 1,
            monitored: true,
            title: "unneeded",
            email: "private@example.invalid",
          },
        ]);
      return Response.json([
        {
          id: 4,
          movieId: 1,
          path: "/movies/Example.mkv",
          size: 1000,
          quality: { quality: { id: 7 } },
          downloadUrl: "https://private.invalid/secret",
        },
      ]);
    },
    {
      preconnect() {
        /* No network in the fixture. */
      },
    },
  );
}
test("GET capture strips unknown secrets and preserves exact identities with unverified files protected", async () => {
  const snapshot = await captureManager(source(), fetcher());
  expect(validateCapture(snapshot)).toMatchObject({
    complete: true,
    stable: true,
  });
  const serialized = JSON.stringify(snapshot);
  for (const secret of [
    "synthetic-secret",
    "must-not-persist",
    "private@example",
    "https://private",
    "unneeded",
  ])
    expect(serialized).not.toContain(secret);
  const report = normalizeCapture(snapshot, {
    targets: [
      {
        mediaId: crypto.randomUUID(),
        kind: "movie",
        externalIds: { tmdb: 10 },
        season: null,
        episode: null,
        checksum: null,
      },
    ],
  });
  expect(report.entries).toMatchObject([
    { state: "adoptable_evidence_ready", owned: false },
    { state: "protected_exact", reasons: ["checksum_unknown"], owned: false },
  ]);
  expect(report.mayTransferOwnership).toBe(false);
});
test("concurrent source drift protects every captured record", async () => {
  const snapshot = await captureManager(source(), fetcher(true));
  expect(validateCapture(snapshot)).toMatchObject({
    complete: false,
    stable: false,
  });
  expect(
    normalizeCapture(snapshot, { targets: [] }).entries.every((entry) =>
      entry.reasons.includes("capture_unstable"),
    ),
  ).toBe(true);
});
test("partial capture absence never means deletion; complete final delta requires review", async () => {
  const baseline = await captureManager(source(), fetcher());
  const records = baseline.records.filter((record) => record.kind !== "file");
  const final = {
    ...baseline,
    startedAt: baseline.completedAt,
    records,
    endpoints: baseline.endpoints.map((endpoint) =>
      endpoint.name === "files"
        ? { ...endpoint, records: 0, digest: recordDigest([]) }
        : endpoint,
    ),
  };
  expect(compareCaptures(baseline, final)).toMatchObject({
    reliable: true,
    requiresReview: true,
    entries: expect.arrayContaining([
      expect.objectContaining({ change: "removed" }),
    ]),
  });
  const partial = {
    ...final,
    endpoints: final.endpoints.map((endpoint) => ({
      ...endpoint,
      complete: false,
      stable: false,
      reason: "read_failed",
    })),
  };
  expect(compareCaptures(baseline, partial)).toMatchObject({
    reliable: false,
    entries: expect.arrayContaining([
      expect.objectContaining({ change: "absence_unproven" }),
    ]),
  });
});
test("forged counts, unknown payload keys and duplicate records are rejected", async () => {
  const snapshot = await captureManager(source(), fetcher());
  expect(() =>
    validateCapture({
      ...snapshot,
      records: [...snapshot.records, snapshot.records[0]],
    }),
  ).toThrow();
  expect(() =>
    validateCapture({
      ...snapshot,
      endpoints: snapshot.endpoints.map((endpoint) => ({
        ...endpoint,
        records: 500,
      })),
    }),
  ).toThrow();
  expect(() => validateCapture({ ...snapshot, apiKey: "secret" })).toThrow();
});
