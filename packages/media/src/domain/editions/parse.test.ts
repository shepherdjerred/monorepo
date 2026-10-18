import { expect, test } from "vitest";
import { parseCutEvidence } from "./parse.ts";
import { evaluateDefaultCut } from "./selection.ts";
import {
  CutEvidenceSchema,
  type CutCanonical,
} from "#shared/editions/evidence.ts";

function evidence(
  text: string,
  options: {
    title?: string;
    aliases?: string[];
    episodeTitles?: CutCanonical["episodeTitles"];
    secondary?: string;
    member?: boolean;
  } = {},
) {
  return parseCutEvidence({
    source: {
      kind: "provider",
      providerId: "privatehd",
      providerReleaseId: "synthetic",
    },
    sourceDigest: "a".repeat(64),
    canonical: {
      rootMediaId: "canonical",
      title: options.title ?? "Example Film",
      aliases: options.aliases ?? [],
      episodeTitles: options.episodeTitles ?? [],
      digest: "b".repeat(64),
    },
    attribution: options.member === true ? "torrent_member" : "provider_texts",
    texts: [
      {
        text,
        provenance: { kind: "release-title", field: "data[].file_name" },
      },
      ...(options.secondary === undefined
        ? []
        : [
            {
              text: options.secondary,
              provenance: {
                kind: "release-title" as const,
                field: "data[].release_title",
              },
            },
          ]),
    ],
  });
}
test.each([
  ["Directors.Cut", "directors_cut"],
  ["Director’s Cut", "directors_cut"],
  ["Extended.Edition", "extended_cut"],
  ["Extended Cut", "extended_cut"],
  ["Theatrical.Version", "theatrical_cut"],
  ["Final Cut", "final_cut"],
  ["Unrated Version", "unrated_cut"],
  ["Uncut Version", "uncut_version"],
])(
  "recognizes explicit metadata %s without changing source bytes",
  (marker, cut) => {
    const text = `Example.Film.2026.${marker}.1080p.WEB-DL`;
    const parsed = evidence(text);
    expect(CutEvidenceSchema.parse(parsed).conclusion).toEqual({
      kind: "named",
      cut,
    });
    expect(parsed.texts[0]?.text).toBe(text);
    const span = parsed.texts[0]?.markers[0];
    expect(text.slice(span?.start, span?.end)).toBe(marker);
  },
);
test.each([
  "EXTENDED",
  "UNRATED",
  "UNCUT",
  "DC",
  "Special.Edition",
  "Unknown.Cut",
  "{edition-DC}",
  "[edition-IMAX]",
])(
  "unsupported explicit qualifier %s protects instead of inventing a cut",
  (marker) => {
    expect(evidence(`Example.Film.2026.${marker}.1080p`).conclusion).toEqual({
      kind: "ambiguous",
    });
  },
);
test.each([
  "IMAX",
  "REMASTERED",
  "REMUX",
  "MULTI",
  "ENGLISH",
  "2160p",
  "WEB-DL",
])("technical metadata %s does not imply a cut", (marker) => {
  expect(evidence(`Example.Film.2026.${marker}`).conclusion).toEqual({
    kind: "standard_unmarked",
  });
});
test("canonical title, verified alias and episode title collisions remain titles", () => {
  expect(
    evidence("The.Final.Cut.2026.1080p", { title: "The Final Cut" }).conclusion
      .kind,
  ).toBe("standard_unmarked");
  expect(
    evidence("The.Director's.Cut.2026.1080p", {
      aliases: ["The Director's Cut"],
    }).conclusion.kind,
  ).toBe("standard_unmarked");
  expect(
    evidence("Example Film - S01E01 - The Final Cut.mkv", {
      episodeTitles: [
        {
          title: "The Final Cut",
          seasonNumber: 1,
          episodeNumber: 1,
          absoluteNumber: null,
        },
      ],
    }).conclusion.kind,
  ).toBe("standard_unmarked");
  expect(
    evidence("Example Film 2026 The Final Cut 1080p", {
      aliases: ["The Final Cut"],
    }).conclusion.kind,
  ).toBe("named");
  expect(
    evidence("The.Final.Cut.2026.Final.Cut.1080p", { title: "The Final Cut" })
      .conclusion.kind,
  ).toBe("named");
});
test("descriptive prose does not become a metadata qualifier", () => {
  expect(
    evidence("Example Film is about a director's cut of an unfinished project")
      .conclusion.kind,
  ).toBe("standard_unmarked");
});
test.each([
  "Different.Name.Directors.Cut/feature.mkv",
  "Different.Name.GROUP.Directors.Cut/feature.mkv",
  "Different.Name.Directors.Cut.mkv",
  "Different.Name.Directors.Cut.mp4",
  "Different.Name.Directors.Cut.m4v",
  "Different.Name.Directors.Cut.avi",
])(
  "cut metadata at path boundaries survives missing canonical title: %s",
  (text) => {
    expect(evidence(text, { member: true }).conclusion).toEqual({
      kind: "named",
      cut: "directors_cut",
    });
  },
);
test.each([
  "Example.Film.S01E01.Extended.Cut.1080p.mkv",
  "Example.Film.S01E01-E02.Extended.Cut.1080p.mkv",
  "Example.Film.S01E01E02.Extended.Cut.1080p.mkv",
  "Example.Film.S01E01.S01E02.Extended.Cut.1080p.mkv",
  "Example.Film.S01.Extended.Cut.1080p.mkv",
])("another episode's title cannot suppress cut evidence in %s", (text) => {
  expect(
    evidence(text, {
      episodeTitles: [
        {
          title: "Extended Cut",
          seasonNumber: 1,
          episodeNumber: 2,
          absoluteNumber: 12,
        },
      ],
    }).conclusion,
  ).toEqual({ kind: "named", cut: "extended_cut" });
});
test("only one exact coordinate permits catalog episode-title suppression", () => {
  const episode = {
    title: "Extended Cut",
    seasonNumber: 1,
    episodeNumber: 2,
    absoluteNumber: 12,
  };
  for (const text of [
    "Example Film S01E02 - Extended Cut 1080p",
    "Example Film 1x02 - Extended Cut 1080p",
    "Example Film - 12 - Extended Cut 1080p",
  ])
    expect(evidence(text, { episodeTitles: [episode] }).conclusion.kind).toBe(
      "standard_unmarked",
    );
  expect(
    evidence("Example Film S01E02 - Extended Cut 1080p", {
      episodeTitles: [episode, episode],
    }).conclusion.kind,
  ).toBe("named");
  expect(
    evidence("Example Film - 11 - Extended Cut 1080p", {
      episodeTitles: [episode],
    }).conclusion.kind,
  ).not.toBe("standard_unmarked");
});
test("bracketed canonical titles remain titles, but dedicated source folders retain cut evidence", () => {
  expect(
    evidence("[The Final Cut] (2026) 1080p", { title: "The Final Cut" })
      .conclusion.kind,
  ).toBe("standard_unmarked");
  expect(
    evidence("Directors Cut/Example Film.2026.1080p.mkv", { member: true })
      .conclusion.kind,
  ).toBe("named");
  expect(
    evidence("Extended/Example Film.2026.1080p.mkv", { member: true })
      .conclusion.kind,
  ).toBe("ambiguous");
});
test.each([
  "Example.Film.2026.1080p.WEB-DL.H264.DDP5.1.Directors.Cut",
  "Example.Film.2026.DTS-HD.MA.5.1.GROUP.Directors.Cut",
  "Different.Raw.Title.2026.VENDOR.Directors.Cut.1080p",
])("unrecognized technical tokens cannot erase an explicit cut: %s", (text) => {
  expect(evidence(text).conclusion).toEqual({
    kind: "named",
    cut: "directors_cut",
  });
});
test("UTF-16 spans preserve surrogate pairs, curly punctuation and normalized fullwidth letters", () => {
  const text = "[🌊] Éxample.Film.2026.Ｄｉｒｅｃｔｏｒ’s Ｃｕｔ.1080p";
  const parsed = evidence(text, { title: "Éxample Film" });
  expect(parsed.conclusion).toEqual({ kind: "named", cut: "directors_cut" });
  const marker = parsed.texts[0]?.markers[0];
  expect(text.slice(marker?.start, marker?.end)).toBe(
    "Ｄｉｒｅｃｔｏｒ’s Ｃｕｔ",
  );
});
test("secondary title contradiction remains attributed and conflicts", () => {
  const parsed = evidence("Example Film 2026 Extended Cut", {
    secondary: "Example Film 2026 Theatrical Cut",
  });
  expect(parsed.texts.map((item) => item.provenance.field)).toEqual([
    "data[].file_name",
    "data[].release_title",
  ]);
  expect(parsed.conclusion).toEqual({
    kind: "conflict",
    cuts: ["extended_cut", "theatrical_cut"],
  });
});
test("provider bounds protect without truncating a dangerous suffix; member paths retain their larger bound", () => {
  const text = `${"x".repeat(501)}/Example Film 2026 Extended Cut.mkv`;
  const provider = evidence(text);
  expect(provider).toMatchObject({
    conclusion: { kind: "ambiguous" },
    issues: ["input_limit_exceeded"],
    texts: [],
  });
  expect(evidence(text, { member: true }).conclusion.kind).toBe("named");
  expect(
    evidence("Example Film", {
      aliases: Array.from({ length: 502 }, () => "Alias"),
    }).issues,
  ).toEqual(["input_limit_exceeded"]);
});
test("default selection protects current provenance and whole-pack conflicts independently", () => {
  const unmarked = evidence("Example Film 2026 2160p WEB-DL");
  const extended = evidence("Example Film 2026 Extended Cut 720p WEB-DL");
  const theatrical = evidence("Example Film 2026 Theatrical Cut 1080p WEB-DL");
  expect(
    evaluateDefaultCut({ candidate: unmarked, current: [unmarked] }).accepted,
  ).toBe(true);
  expect(
    evaluateDefaultCut({ candidate: unmarked, current: [extended] }).reasons,
  ).toContain("edition_current_requires_classification");
  expect(
    evaluateDefaultCut({
      candidate: unmarked,
      current: [],
      members: [extended, theatrical],
    }).reasons,
  ).toContain("edition_evidence_conflict");
  expect(
    evaluateDefaultCut({ candidate: extended, current: [] }).accepted,
  ).toBe(false);
});
