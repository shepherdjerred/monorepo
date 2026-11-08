import { expect, test } from "vitest";
import snapshot from "#migration/fixtures/resolved-profiles.json";
import { importResolvedProfiles } from "#migration/profile-import.ts";
import { prepareResolvedEvidence } from "#migration/runtime-evidence.ts";
import { parseMovieCutV2 } from "#domain/editions/parse-v2.ts";
import {
  MovieEditionKeySchema,
  MOVIE_EDITION_REGISTRY,
} from "#shared/movie-editions/registry.ts";
import { prepareResolvedMovieEvidenceV4 } from "./prepare.ts";

const profile = importResolvedProfiles(snapshot).find(
  (report) => report.source === "radarr",
)?.profiles[0];
if (profile === undefined)
  throw new Error("Actual captured Radarr fixture profile missing");
const movieProfile = profile;

function fixture(label: string, name = "Example Film") {
  const title = `${name.replaceAll(" ", ".")}.2020${label === "" ? "" : `.${label.replaceAll(" ", ".")}`}.2160p.WEB-DL.H264.English-GROUP`;
  const cut = parseMovieCutV2({
    source: {
      kind: "provider",
      providerId: "knaben",
      providerReleaseId: "synthetic",
    },
    sourceDigest: "a".repeat(64),
    canonical: {
      rootMediaId: "movie",
      title: name,
      aliases: [],
      digest: "b".repeat(64),
    },
    attribution: "provider_texts",
    texts: [
      { text: title, provenance: { kind: "release-title", field: "title" } },
    ],
  });
  return {
    cut,
    input: {
      id: "source",
      title,
      filename: `${title}.mkv`,
      identityConfirmed: true,
      sizeBytes: 40_000_000,
      runtimeMinutes: 1,
      originalLanguage: "en",
      audioLanguages: ["en"],
      specialEpisode: false,
    },
  };
}

test.each(MovieEditionKeySchema.options)(
  "resolved movie parsing preserves %s tokens for custom formats while measuring quality independently",
  (edition) => {
    const label = MOVIE_EDITION_REGISTRY[edition].plexLabel;
    const f = fixture(label);
    const before = JSON.stringify(f);
    const evidence = prepareResolvedMovieEvidenceV4(
      movieProfile,
      f.input,
      f.cut,
    );
    const plain = fixture("");
    const expected = prepareResolvedEvidence(movieProfile, plain.input);
    expect(evidence).toMatchObject({
      parserVersion: "scene-movie-v4",
      protectedReasons: [],
      release: {
        qualityId: expected.release.qualityId,
        revision: { version: 1, real: 0 },
        releaseGroup: "GROUP",
        filename: f.input.filename,
        releaseTitle: `A.Movie${f.input.title.slice("Example.Film".length)}`,
      },
    });
    expect(JSON.stringify(f)).toBe(before);
    if (edition === "default")
      expect(evidence.release).toEqual(expected.release);
    else
      expect(
        prepareResolvedEvidence(movieProfile, f.input).protectedReasons,
      ).toEqual(["source_parse_unsupported"]);
  },
);

test.each(["The Final Cut", "Extended", "Uncut"])(
  "canonical movie title %s is not treated as a cut marker",
  (name) => {
    const f = fixture("", name);
    expect(f.cut.conclusion).toEqual({ kind: "standard_unmarked" });
    expect(
      prepareResolvedMovieEvidenceV4(movieProfile, f.input, f.cut),
    ).toMatchObject({
      protectedReasons: [],
      release: {
        releaseTitle: `${name.includes(" ") ? "A.Movie" : "A Movie"}.2020.2160p.WEB-DL.H264.English-GROUP`,
      },
    });
  },
);

test("unsupported grammar stays protected and substituted source text fails", () => {
  const f = fixture("IMAX");
  expect(
    prepareResolvedMovieEvidenceV4(movieProfile, f.input, f.cut)
      .protectedReasons,
  ).toEqual(["source_parse_unsupported"]);
  expect(() =>
    prepareResolvedMovieEvidenceV4(
      movieProfile,
      { ...f.input, title: f.input.title.replace("Example", "Another") },
      f.cut,
    ),
  ).toThrow("exact provider title");
});
