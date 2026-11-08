import { expect, test } from "vitest";
import { parseMovieCutV2 } from "./parse-v2.ts";
import { parseCutEvidence } from "./parse.ts";
import { evaluateMovieCutV2 } from "./selection-v2.ts";
import {
  MovieCutEvidenceV2Schema,
  MovieCutDecisionV2Schema,
} from "#shared/movie-editions/cut-v2.ts";
import {
  MovieEditionKeySchema,
  type MovieEditionKey,
} from "#shared/movie-editions/registry.ts";

function input(text: string, member = false, title = "Example Film") {
  return {
    source: member
      ? { kind: "member" as const, attemptId: "attempt", torrentFileIndex: 0 }
      : {
          kind: "provider" as const,
          providerId: "knaben",
          providerReleaseId: "release",
        },
    sourceDigest: "a".repeat(64),
    canonical: {
      rootMediaId: "movie",
      title,
      aliases: [],
      digest: "b".repeat(64),
    },
    attribution: member
      ? ("torrent_member" as const)
      : ("provider_texts" as const),
    texts: [
      {
        text,
        provenance: {
          kind: "release-title" as const,
          field: member ? "member.relativePath" : "title",
        },
      },
    ],
  };
}
function evidence(marker: string, member = false) {
  return MovieCutEvidenceV2Schema.parse(
    parseMovieCutV2(
      input(
        `Example.Film.2026.${marker}.1080p.WEB-DL${member ? ".mkv" : ""}`,
        member,
      ),
    ),
  );
}
const LABELS: Readonly<Record<MovieEditionKey, string>> = {
  default: "",
  directors_cut: "Director's.Cut",
  theatrical_cut: "THEATRICAL",
  extended_cut: "EXTENDED",
  final_cut: "Final.Cut",
  unrated_cut: "UNRATED",
  uncut_version: "UNCUT",
};

test.each(MovieEditionKeySchema.options)(
  "consistent %s release and member labels admit only that edition",
  (edition) => {
    const candidate = evidence(LABELS[edition]);
    const member = evidence(LABELS[edition], true);
    for (const requested of MovieEditionKeySchema.options) {
      const decision = MovieCutDecisionV2Schema.parse(
        evaluateMovieCutV2({
          edition: requested,
          phase: "physical",
          candidate,
          current: [],
          members: [member],
        }),
      );
      expect(decision.accepted).toBe(requested === edition);
    }
  },
);

test.each(["Director's Cut", "{edition-Director's Cut}"])(
  "recognizes conventional %s while retaining the literal source text",
  (label) => {
    const parsed = evidence(label);
    expect(parsed.conclusion).toEqual({ kind: "named", cut: "directors_cut" });
    expect(parsed.texts[0]?.text).toContain(label);
  },
);

test("absence never establishes theatrical and an unmarked member cannot satisfy a named release", () => {
  const unmarked = evidence("");
  expect(unmarked.conclusion).toEqual({ kind: "standard_unmarked" });
  expect(
    evaluateMovieCutV2({
      edition: "theatrical_cut",
      phase: "candidate",
      candidate: unmarked,
      current: [],
      members: [],
    }).accepted,
  ).toBe(false);
  expect(
    evaluateMovieCutV2({
      edition: "extended_cut",
      phase: "physical",
      candidate: evidence("EXTENDED"),
      current: [],
      members: [evidence("", true)],
    }).reasons,
  ).toContain("edition_candidate_incompatible");
});

test("physical admission requires all member evidence and rejects conflicting conventional labels", () => {
  const candidate = evidence("EXTENDED");
  expect(
    evaluateMovieCutV2({
      edition: "extended_cut",
      phase: "physical",
      candidate,
      current: [],
      members: [],
    }).reasons,
  ).toEqual(["edition_member_evidence_missing"]);
  expect(
    evaluateMovieCutV2({
      edition: "extended_cut",
      phase: "physical",
      candidate,
      current: [],
      members: [evidence("Extended.Cut", true), evidence("Final.Cut", true)],
    }).reasons,
  ).toContain("edition_evidence_conflict");
  expect(evidence("Extended.Cut.Final.Cut").conclusion).toEqual({
    kind: "conflict",
    cuts: ["extended_cut", "final_cut"],
  });
});

test("another canonical movie and an unclassified predecessor cannot supply edition evidence", () => {
  const candidate = evidence("EXTENDED");
  expect(
    evaluateMovieCutV2({
      edition: "extended_cut",
      phase: "physical",
      candidate,
      current: [],
      members: [
        { ...evidence("EXTENDED", true), canonicalDigest: "c".repeat(64) },
      ],
    }).reasons,
  ).toContain("edition_canonical_mismatch");
  expect(
    evaluateMovieCutV2({
      edition: "extended_cut",
      phase: "candidate",
      candidate,
      current: [evidence("")],
      members: [],
    }).reasons,
  ).toContain("edition_current_requires_classification");
});

test.each(["The Final Cut", "Extended", "Uncut", "Theatrical", "DC"])(
  "canonical title %s is not a release marker",
  (title) => {
    const parsed = parseMovieCutV2(
      input(`${title} (2026) 1080p.mkv`, true, title),
    );
    expect(parsed.conclusion).toEqual({ kind: "standard_unmarked" });
  },
);

test("unsupported labels and bounded input remain protected", () => {
  expect(evidence("{edition-IMAX}").conclusion).toEqual({ kind: "ambiguous" });
  expect(evidence("DC").conclusion).toEqual({ kind: "ambiguous" });
  expect(evidence("{edition-DC}").conclusion).toEqual({ kind: "ambiguous" });
  const oversized = parseMovieCutV2(
    input(`Example Film ${"x".repeat(501)} EXTENDED`),
  );
  expect(oversized.issues).toEqual(["input_limit_exceeded"]);
  expect(oversized.conclusion).toEqual({ kind: "ambiguous" });
});

test("new conventional assessments never reinterpret the historical v1 parser", () => {
  const source = input("Example.Film.2026.EXTENDED.1080p");
  const old = parseCutEvidence(source);
  const literal = JSON.stringify(old);
  expect(old.parserVersion).toBe("cut-markers-v1");
  expect(old.conclusion).toEqual({ kind: "ambiguous" });
  expect(parseMovieCutV2(source).conclusion).toEqual({
    kind: "named",
    cut: "extended_cut",
  });
  expect(JSON.stringify(old)).toBe(literal);
  expect(parseCutEvidence(source)).toEqual(old);
});
