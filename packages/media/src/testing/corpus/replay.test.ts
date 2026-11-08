import { expect, test } from "vitest";
import { fileURLToPath } from "node:url";
import movie from "./seeds/movie.json";
import profile from "./seeds/profile.json";
import sourceSnapshot from "#migration/fixtures/resolved-profiles.json";
import { SourceInventorySchema } from "#domain/resolved-contract.ts";
import { CorpusInputSchema, CorpusManifestSchema } from "./contract.ts";
import manifest from "./seeds/manifest.json";
import { corpusProfile, replayCorpusCandidate } from "./replay.ts";
import { replayCorpusPlan } from "./planning.ts";
import { runCorpus } from "./run.ts";
import { loadCorpus } from "./load.ts";
import { reportCorpusCase, corpusReport } from "./report.ts";

const filename = fileURLToPath(new URL("seeds/manifest.json", import.meta.url));
const descriptor = CorpusManifestSchema.parse(manifest).cases[0];
if (descriptor === undefined) throw new Error("Authored movie case missing");
const policy = corpusProfile(descriptor.profile, profile);

test("independently authored fictional baseline plans movies, a complete season and a real score improvement", async () => {
  const result = await runCorpus(filename);
  expect(result.passed).toBe(true);
  expect(result.counts).toMatchObject({
    cases: 3,
    synthetic: 3,
    captured: 0,
    considered: 11,
    accepted: 4,
    rejected: 7,
    planned: 4,
    wrongAccept: 0,
    missedValid: 0,
    rankingDifferences: 0,
    importPlanDifferences: 0,
    unsafeImportPlans: 0,
  });
  expect(
    result.cases
      .flatMap((value) => value.candidates)
      .filter((value) => value.planning.status === "planned"),
  ).toHaveLength(4);
  expect(
    result.cases.find((value) => value.id === "complete-season")?.candidates[0]
      ?.planning.entries,
  ).toHaveLength(2);
  expect(
    result.cases.find((value) => value.id === "same-quality-upgrade")?.ranking,
  ).toEqual(["improved"]);
  expect(result.limits.physicalImport).toBe("not_exercised");
  expect(result.limits.consentAndRequestAuthority).toBe("not_exercised");
});

test.each([
  "path",
  "codec",
  "audio",
  "bytes",
  "progress",
  "duplicate",
] as const)(
  "actual member planning protects against %s substitution after release matching",
  async (mutation) => {
    const input = CorpusInputSchema.parse(movie);
    const candidate = input.candidates[0];
    const member = candidate?.members?.[0];
    if (candidate === undefined || member === undefined)
      throw new Error("Authored member missing");
    if (mutation === "path") member.name = "../foreign.mkv";
    if (mutation === "bytes") member.sizeBytes += 1;
    if (mutation === "progress") member.progress = 0.5;
    if (mutation === "duplicate")
      candidate.members?.push(structuredClone(member));
    if (mutation === "codec" || mutation === "audio")
      member.probe = {
        format: {
          duration: "6000",
          size: "4000000000",
          format_name: "matroska",
        },
        streams: [
          {
            index: 0,
            codec_type: "video",
            codec_name: mutation === "codec" ? "vp9" : "hevc",
            width: 1920,
            height: 1080,
          },
          {
            index: 1,
            codec_type: "audio",
            codec_name: "aac",
            tags: { language: mutation === "audio" ? "jpn" : "eng" },
          },
        ],
      };
    const matched = await replayCorpusCandidate(input, candidate, policy);
    expect(matched.accepted).toBe(true);
    const plan = await replayCorpusPlan({
      input,
      raw: candidate,
      candidate: matched,
      policy,
    });
    expect(plan.status).toBe("protected");
    expect(plan.entries).toEqual([]);
    expect(plan.reasons.length).toBeGreaterThan(0);
  },
);

test("changing labels cannot alter production decisions and makes wrong acceptance and unsafe plans fail", async () => {
  const loaded = await loadCorpus(filename);
  const entry = loaded.manifest.cases[0];
  if (entry === undefined) throw new Error("Authored case missing");
  const original = await loaded.readCase(entry);
  const before = await reportCorpusCase(original);
  const changed = structuredClone(original);
  const label = changed.labels.candidates[0];
  const plan = label?.plan?.[0];
  if (label === undefined || plan === undefined)
    throw new Error("Authored positive label missing");
  label.disposition = "reject";
  plan.libraryPath = "a-different-work/a-different-work.mkv";
  const after = await reportCorpusCase(changed);
  expect(
    after.candidates.map(({ differences: _differences, ...result }) => result),
  ).toEqual(
    before.candidates.map(({ differences: _differences, ...result }) => result),
  );
  expect(after.candidates[0]?.differences).toContain("wrong_accept");
  expect(after.candidates[0]?.differences).toContain("unsafe_import_plan");
  expect(
    corpusReport(loaded.manifest.corpusId, loaded.manifestHash, [after]).passed,
  ).toBe(false);
});

test("rejecting a known valid baseline is a failed replay even with no unsafe automatic acceptance", async () => {
  const loaded = await loadCorpus(filename);
  const entry = loaded.manifest.cases[0];
  if (entry === undefined) throw new Error("Authored case missing");
  const value = await loaded.readCase(entry);
  if (value.profile.kind !== "native")
    throw new Error("Expected explicit fictional policy");
  value.profile.profile.requiredAudioLanguages = ["unavailable-language"];
  const report = await reportCorpusCase(value);
  expect(report.hardFailure).toBe(false);
  expect(
    report.candidates.some((candidate) =>
      candidate.differences.includes("missed_valid"),
    ),
  ).toBe(true);
  expect(
    corpusReport(loaded.manifest.corpusId, loaded.manifestHash, [report])
      .passed,
  ).toBe(false);
});

test.each(["radarr", "sonarr"] as const)(
  "captured %s profile keeps every literal source limit and format score",
  (source) => {
    const inventory = SourceInventorySchema.parse(
      sourceSnapshot.inventories.find((value) => value.source === source),
    );
    const first = inventory.profiles[0];
    if (first === undefined) throw new Error("Captured profile absent");
    const resolved = corpusProfile(
      {
        kind: "source_snapshot",
        source,
        profileId: first.id,
        artifact: descriptor.profile.artifact,
        provenance: {
          ...descriptor.profile.provenance,
          kind: "captured",
          sourceVersion: inventory.version,
        },
      },
      sourceSnapshot,
    );
    if (resolved.kind !== "resolved")
      throw new Error("Captured profile was replaced by native rules");
    expect(resolved.profile.qualityDefinitions).toEqual(
      inventory.qualityDefinitions,
    );
    expect(resolved.profile.profile).toEqual(first);
    expect(resolved.profile.customFormats).toEqual(inventory.customFormats);
    expect(resolved.profile.properPreference).toBe(inventory.properPreference);
  },
);
