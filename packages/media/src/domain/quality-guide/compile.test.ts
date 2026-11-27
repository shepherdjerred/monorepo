import { describe, expect, it } from "vitest";
import fixture from "./guide-fixture.json";
import { compileQualityGuide } from "./compile.ts";
import { GUIDE_PRESETS, GuideBundleSchema } from "./contract.ts";
import {
  ManagedGuideSchema,
  type QualityGuideKind,
} from "#shared/quality-guide/contract.ts";

const bundle = (kind: QualityGuideKind) => ({
  revision: fixture.revision,
  committedAt: fixture.committedAt,
  ...fixture.sources[kind],
});

describe("selected living-room guide", () => {
  it("keeps equal WEB ranks, the selected remux/WEB cutoffs and measured audio policy", () => {
    const movie = compileQualityGuide("movie", bundle("movie"));
    const tv = compileQualityGuide("series", bundle("series"));
    expect(movie.rules.resolved?.profile.items.at(-1)).toMatchObject({
      quality: { name: "Remux-2160p" },
    });
    expect(movie.rules.qualities.slice(0, 2)).toEqual([
      "WEB 720p",
      "Bluray|WEB-1080p",
    ]);
    expect(tv.rules.resolved?.profile.items.at(-1)).toMatchObject({
      name: "WEB 2160p",
      items: [
        { quality: { name: "WEBDL-2160p" } },
        { quality: { name: "WEBRip-2160p" } },
      ],
    });
    expect(tv.rules.resolved?.profile.cutoff).toBe(1004);
    expect(tv.rules.resolved?.properPreference).toBe("preferAndUpgrade");
    expect(tv.rules.resolved?.householdPolicy).toMatchObject({
      audio: "original",
      englishCaptionsForForeignAudio: true,
      provisionalUnknownListingAudio: true,
    });
    expect(
      tv.rules.resolved?.qualityDefinitions.find(
        (row) => row.quality.name === "WEBDL-2160p",
      ),
    ).toMatchObject({ maxSize: 1100, preferredSize: 900 });
  });
  it.each([
    [
      "movie",
      "standard-4k",
      { name: "Standard 4K Movies", resolution: 2160, sizeTarget: 200 },
    ],
    [
      "series",
      "standard-4k",
      { name: "Standard 4K TV", resolution: 2160, sizeTarget: 200 },
    ],
    [
      "movie",
      "standard-1080p",
      { name: "Standard 1080p Movies", resolution: 1080, sizeTarget: 80 },
    ],
    [
      "series",
      "standard-1080p",
      { name: "Standard 1080p TV", resolution: 1080, sizeTarget: 80 },
    ],
  ] as const)(
    "compiles %s %s with its size target and full fallback definitions",
    (kind, variant, { name, resolution, sizeTarget }) => {
      const compiled = compileQualityGuide(kind, bundle(kind), {}, variant);
      const trash = compileQualityGuide(kind, bundle(kind));
      const profile = compiled.rules.resolved;
      if (profile === undefined) throw new Error("Resolved profile missing");
      const qualities = profile.profile.items.flatMap((item) =>
        "quality" in item
          ? [item.quality]
          : item.items.map(({ quality }) => quality),
      );
      expect(compiled.name).toBe(name);
      expect(compiled.rules.managedGuide?.variant).toBe(variant);
      expect(compiled.rules.managedGuide?.contentHash).not.toBe(
        trash.rules.managedGuide?.contentHash,
      );
      expect(Math.max(...qualities.map((item) => item.resolution))).toBe(
        resolution,
      );
      expect(qualities.some((item) => item.name.includes("Remux"))).toBe(false);
      expect(profile.qualityDefinitions).toHaveLength(
        trash.rules.resolved?.qualityDefinitions.length ?? 0,
      );
      for (const item of profile.qualityDefinitions.filter((entry) =>
        qualities.some((quality) => quality.id === entry.quality.id),
      )) {
        expect(item.maxSize).toBe(sizeTarget);
        expect(item.preferredSize).toBeLessThanOrEqual(sizeTarget);
        expect(item.minSize).toBe(
          trash.rules.resolved?.qualityDefinitions.find(
            (entry) => entry.quality.id === item.quality.id,
          )?.minSize,
        );
      }
    },
  );
  it("accepts old persisted TRaSH metadata without a variant field", () => {
    const compiled = compileQualityGuide("movie", bundle("movie"));
    const { variant, ...legacy } = ManagedGuideSchema.parse(
      compiled.rules.managedGuide,
    );
    expect(variant).toBe("trash");
    expect(ManagedGuideSchema.parse(legacy)).toEqual(legacy);
  });
  it("retains mild DD+ preferences and explicitly neutral lossless scores", () => {
    for (const kind of ["movie", "series"] as const) {
      const formats = compileQualityGuide(kind, bundle(kind)).rules.resolved
        ?.profile.formatItems;
      expect(formats?.find((row) => row.name === "DD+ ATMOS")?.score).toBe(300);
      expect(formats?.find((row) => row.name === "DD+")?.score).toBe(50);
      expect(
        formats?.find((row) => row.name === "DV (w/o HDR fallback)")?.score,
      ).toBe(-10_000);
      if (kind === "movie") {
        for (const name of [
          "TrueHD ATMOS",
          "DTS X",
          "TrueHD",
          "DTS-HD MA",
          "FLAC",
          "PCM",
        ])
          expect(formats?.find((row) => row.name === name)?.score).toBe(0);
      }
    }
  });
  it("preserves overrides and does not version-bump because unrelated guide files changed", () => {
    const id = GUIDE_PRESETS.movie.formats.find((row) => row.score === 300)?.id;
    if (id === undefined) throw new Error("Missing Atmos override fixture");
    const one = compileQualityGuide("movie", bundle("movie"), { [id]: 350 });
    const two = compileQualityGuide(
      "movie",
      {
        ...bundle("movie"),
        revision: "b".repeat(40),
        committedAt: "2026-11-14T00:00:00Z",
      },
      { [id]: 350 },
    );
    expect(one.rules.managedGuide?.contentHash).toBe(
      two.rules.managedGuide?.contentHash,
    );
    expect(one.rules.managedGuide?.scoreOverrides).toEqual({ [id]: 350 });
    expect(
      one.rules.resolved?.profile.formatItems.find(
        (row) => row.name === "DD+ ATMOS",
      )?.score,
    ).toBe(350);
  });
  it("refuses duplicate/missing definitions, unselected overrides and unsupported changed semantics", () => {
    const source = bundle("series");
    expect(() =>
      compileQualityGuide("series", {
        ...source,
        formats: [...source.formats, source.formats[0]],
      }),
    ).toThrow("Duplicate");
    expect(() =>
      compileQualityGuide("series", {
        ...source,
        formats: source.formats.slice(1),
      }),
    ).toThrow("missing");
    expect(() =>
      compileQualityGuide("series", source, { ["a".repeat(32)]: 5 }),
    ).toThrow("unselected");
    const changed = structuredClone(source);
    const first = changed.formats[0]?.specifications[0];
    if (first === undefined) throw new Error("Missing language specification");
    first.implementation = "UnexpectedSpecification";
    expect(() => compileQualityGuide("series", changed)).toThrow("unsupported");
  });
  it("refuses source score maps and size intervals it cannot validate", () => {
    const source = GuideBundleSchema.parse(bundle("series"));
    const first = source.formats.find((row) => row.name === "HDR");
    if (first === undefined) throw new Error("Missing HDR fixture");
    first.trash_scores = { unsupported: 123 };
    expect(() => compileQualityGuide("series", source)).toThrow(
      "default score",
    );
    const invalid = structuredClone(bundle("series"));
    const size = invalid.sizes.qualities.find(
      (row) => row.quality === "WEBDL-2160p",
    );
    if (size === undefined) throw new Error("Missing size fixture");
    size.min = 1200;
    expect(() => compileQualityGuide("series", invalid)).toThrow(
      "size interval",
    );
  });
});
