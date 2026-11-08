import { expect, test } from "vitest";
import {
  matchRelease,
  normalizeMediaTitle,
  type ReleaseMatchInput,
} from "#domain/release-parser.ts";
import { parseMovieCutV2 } from "./parse-v2.ts";
import { matchMovieReleaseV4 } from "./release-v4.ts";
import { evaluateMovieCutV2 } from "./selection-v2.ts";

function fixture(label: string, title = "Example Film", year = 2026) {
  const input: ReleaseMatchInput = {
    id: "candidate",
    providerId: "knaben",
    title: `${title}.${String(year)}.${label}.1080p.WEB-DL.H264.ENG`,
    sizeBytes: 1000,
    media: { id: "movie", kind: "movie", title, year },
  };
  const evidence = parseMovieCutV2({
    source: {
      kind: "provider",
      providerId: "knaben",
      providerReleaseId: "synthetic",
    },
    sourceDigest: "a".repeat(64),
    canonical: {
      rootMediaId: "movie",
      title,
      aliases: [],
      digest: "b".repeat(64),
    },
    attribution: "provider_texts",
    texts: [
      {
        text: input.title,
        provenance: { kind: "release-title", field: "title" },
      },
    ],
  });
  return { input, evidence };
}

test.each([
  "Extended.Cut",
  "Director's.Cut",
  "THEATRICAL",
  "Final.Cut",
  "UNRATED",
  "UNCUT",
  "{edition-Extended Cut}",
])(
  "v4 work identity recognizes %s without changing retained source or cut evidence",
  (label) => {
    const f = fixture(label);
    const original = JSON.stringify(f.evidence);
    const matched = matchMovieReleaseV4(f.input, f.evidence);
    expect(matched.attributes).toMatchObject({
      title: f.input.title,
      identityConfidence: "exact",
      mediaIds: ["movie"],
      quality: "WEB-1080p",
      codec: "H264",
    });
    expect(matched.parsed).toMatchObject({ title: "example film", year: 2026 });
    expect(f.evidence.conclusion.kind).toBe("named");
    expect(JSON.stringify(f.evidence)).toBe(original);
  },
);

test.each(["The Final Cut", "Extended", "Uncut"])(
  "canonical title %s is preserved in work identity",
  (title) => {
    const f = fixture("", title);
    const matched = matchMovieReleaseV4(f.input, f.evidence);
    expect(matched.attributes.identityConfidence).toBe("exact");
    expect(matched.parsed.title).toBe(normalizeMediaTitle(title));
    expect(f.evidence.conclusion).toEqual({ kind: "standard_unmarked" });
  },
);

test("cut normalization cannot hide a different movie or year", () => {
  const f = fixture("Extended.Cut", "Other Movie", 2025);
  const input = {
    ...f.input,
    media: { ...f.input.media, title: "Example Film", year: 2026 },
  };
  const matched = matchMovieReleaseV4(input, f.evidence);
  expect(matched.attributes.identityConfidence).toBe("mismatch");
  expect(matched.reasons).toContain("title_mismatch");
});

test("recognizing work identity does not resolve an unsupported edition label", () => {
  const f = fixture("{edition-IMAX}");
  expect(
    matchMovieReleaseV4(f.input, f.evidence).attributes.identityConfidence,
  ).toBe("exact");
  expect(
    evaluateMovieCutV2({
      edition: "extended_cut",
      phase: "candidate",
      candidate: f.evidence,
      current: [],
      members: [],
    }),
  ).toMatchObject({ accepted: false });
  expect(f.evidence.conclusion).toEqual({ kind: "ambiguous" });
});

test("missing, substituted and overlapping source spans fail instead of changing identity facts", () => {
  const f = fixture("Extended.Cut");
  expect(() =>
    matchMovieReleaseV4(f.input, { ...f.evidence, texts: [] }),
  ).toThrow("exact provider title");
  const primary = f.evidence.texts[0];
  const marker = primary?.markers[0];
  if (primary === undefined || marker === undefined)
    throw new Error("Synthetic explicit cut marker missing");
  expect(() =>
    matchMovieReleaseV4(f.input, {
      ...f.evidence,
      texts: [{ ...primary, markers: [{ ...marker, token: "substituted" }] }],
    }),
  ).toThrow("invalid source span");
  expect(() =>
    matchMovieReleaseV4(f.input, {
      ...f.evidence,
      texts: [{ ...primary, markers: [marker, marker] }],
    }),
  ).toThrow("invalid source span");
});

test("v4 leaves unmarked matching and literal legacy matching behavior unchanged", () => {
  const unmarked = fixture("");
  expect(matchMovieReleaseV4(unmarked.input, unmarked.evidence)).toEqual(
    matchRelease(unmarked.input),
  );
  const named = fixture("Extended.Cut");
  const historical = matchRelease(named.input);
  expect(historical.attributes.identityConfidence).toBe("mismatch");
  expect(
    matchMovieReleaseV4(named.input, named.evidence).attributes
      .identityConfidence,
  ).toBe("exact");
  expect(matchRelease(named.input)).toEqual(historical);
});
