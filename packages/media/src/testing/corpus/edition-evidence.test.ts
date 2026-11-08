import { expect, test } from "vitest";
import { z } from "zod";
import type { ReleaseCandidate } from "#generated/prisma/client.ts";
import { AvistazFamilyProvider } from "#integrations/providers.ts";
import { releaseCut } from "#infrastructure/editions/cut-context.ts";
import { evaluateDefaultCut } from "#domain/editions/selection.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import movie from "./seeds/movie.json";
import manifest from "./seeds/manifest.json";
import profile from "./seeds/profile.json";
import {
  CorpusInputSchema,
  CorpusLabelsSchema,
  CorpusManifestSchema,
  CorpusReleaseSchema,
  type CorpusRelease,
} from "./contract.ts";
import { corpusCut, corpusProfile, replayCorpusCandidate } from "./replay.ts";
import { replayCorpusPlan } from "./planning.ts";
import { reportCorpusCase } from "./report.ts";

// Fictional wire inputs: real provider parsing/classification, never a captured
// live response or a manufactured identity confirmation/import plan.
const input = CorpusInputSchema.parse(movie);
const baseline = CorpusReleaseSchema.parse(input.candidates[0]);
const descriptor = CorpusManifestSchema.parse(manifest).cases[0];
if (descriptor === undefined)
  throw new Error("Authored fictional corpus baseline missing");
const policy = corpusProfile(descriptor.profile, profile);

async function providerRelease(primary: string, secondary: string) {
  const provider = new AvistazFamilyProvider(
    {
      providerId: "privatehd",
      username: "fictional",
      password: "fictional",
      pid: "fictional",
    },
    async (url) =>
      url.pathname.endsWith("auth")
        ? Response.json({ token: "fictional-session" })
        : Response.json({
            data: [
              {
                url: "https://privatehd.to/torrent/fictional",
                download: "https://privatehd.to/download/fictional",
                file_name: primary,
                release_title: secondary,
                info_hash: "a".repeat(40),
                file_size: baseline.sizeBytes,
                seed: 1,
              },
            ],
          }),
  );
  await provider.login();
  const candidates = await provider.search({
    query: "The Paper Lantern",
    kind: "movie",
    page: 1,
  });
  const candidate = candidates[0];
  if (candidate?.editionEvidence === undefined)
    throw new Error("Actual provider parser omitted attributed fixture fields");
  const raw = CorpusReleaseSchema.parse({
    ...baseline,
    providerId: candidate.providerId,
    title: candidate.title,
    sizeBytes: candidate.sizeBytes,
    references: candidate.references ?? [],
    editionEvidence: candidate.editionEvidence,
  });
  const stored: ReleaseCandidate = {
    id: "00000000-0000-4000-8000-000000000001",
    providerId: candidate.providerId,
    providerReleaseId: candidate.providerReleaseId,
    title: candidate.title,
    attributes: {},
    evaluation: {},
    encryptedSource: null,
    mediaIds: [],
    searchedForMediaIds: [],
    createdAt: new Date("2026-01-01T00:00:00Z"),
    sourceEvidence: z.json().parse({
      infoHash: candidate.infoHash,
      editionEvidence: candidate.editionEvidence,
    }),
  };
  return { raw, stored };
}

function productionCut(stored: ReleaseCandidate) {
  return releaseCut(stored, {
    rootMediaId: "lantern",
    title: "The Paper Lantern",
    aliases: [],
    episodeTitles: [],
    digest: snapshotHash(input.catalog),
  });
}

test.each([
  {
    primary: baseline.title,
    secondary: "The.Paper.Lantern.2024.Directors.Cut.1080p",
    kind: "named",
    reason: "edition_candidate_incompatible",
  },
  {
    primary: baseline.title,
    secondary: "The.Paper.Lantern.2024.Special.Edition.1080p",
    kind: "ambiguous",
    reason: "edition_evidence_ambiguous",
  },
  {
    primary: "The.Paper.Lantern.2024.Extended.Cut.1080p.WEB-DL.HEVC.ENG",
    secondary: "The.Paper.Lantern.2024.Theatrical.Cut.1080p",
    kind: "conflict",
    reason: "edition_evidence_conflict",
  },
])(
  "actual provider multi-field $kind evidence has production cut semantics and cannot be accepted by corpus replay",
  async ({ primary, secondary, kind, reason }) => {
    const { raw, stored } = await providerRelease(primary, secondary);
    const before = JSON.stringify(raw);
    const corpus = corpusCut(input, raw);
    const production = productionCut(stored);
    expect(corpus.conclusion.kind).toBe(kind);
    expect(corpus.conclusion).toEqual(production.conclusion);
    expect(corpus.texts).toEqual(production.texts);
    expect(corpus.issues).toEqual(production.issues);
    expect(corpus.texts.map((value) => value.provenance.field)).toEqual([
      "retained.primaryTitle",
      "file_name",
      "release_title",
    ]);
    const selected = evaluateDefaultCut({ candidate: production, current: [] });
    expect(selected.accepted).toBe(false);
    expect(selected.reasons).toContain(reason);
    const result = await replayCorpusCandidate(input, raw, policy);
    expect(result.accepted).toBe(false);
    expect(result.edition).toBe(kind);
    expect(result.reasons).toContain(reason);
    expect(
      await replayCorpusPlan({ input, raw, candidate: result, policy }),
    ).toMatchObject({ status: "protected", entries: [] });
    expect(JSON.stringify(raw)).toBe(before);
  },
);

test("absent evidence retains old input bytes and empty evidence cannot erase a named primary", () => {
  expect(CorpusReleaseSchema.parse(baseline)).not.toHaveProperty(
    "editionEvidence",
  );
  expect(JSON.stringify(CorpusReleaseSchema.parse(baseline))).toBe(
    JSON.stringify(baseline),
  );
  expect(corpusCut(input, baseline)).toMatchObject({
    attribution: "provider_texts",
    conclusion: { kind: "standard_unmarked" },
  });
  expect(
    corpusCut(input, baseline).texts.map((row) => row.provenance.field),
  ).toEqual(["title"]);
  const named = CorpusReleaseSchema.parse({
    ...baseline,
    title: "The.Paper.Lantern.2024.Extended.Cut.1080p",
    editionEvidence: [],
  });
  expect(named.editionEvidence).toEqual([]);
  expect(corpusCut(input, named).conclusion).toEqual({
    kind: "named",
    cut: "extended_cut",
  });
});

test("current-release secondary evidence protects upgrades while member evidence remains its own literal boundary", async () => {
  const { raw } = await providerRelease(
    baseline.title,
    "The.Paper.Lantern.2024.Extended.Cut.1080p",
  );
  const current = CorpusInputSchema.parse({
    ...input,
    current: { ...raw, key: "retained-current" },
  });
  const result = await replayCorpusCandidate(current, baseline, policy);
  expect(result.accepted).toBe(false);
  expect(result.reasons).toContain("edition_current_requires_classification");
  const originalMember = baseline.members?.[0];
  if (originalMember === undefined) throw new Error("Authored member missing");
  const member = corpusCut(input, raw, { name: originalMember.name, index: 0 });
  expect(member.attribution).toBe("torrent_member");
  expect(member.conclusion.kind).toBe("standard_unmarked");
  expect(member.texts.map((row) => row.provenance.field)).toEqual(["name"]);
});

test("production evidence bounds reject oversized fields and preserve the classifier's combined-text limit", async () => {
  const { raw, stored } = await providerRelease(baseline.title, baseline.title);
  const field = raw.editionEvidence?.[0];
  if (field === undefined) throw new Error("Attributed fixture text missing");
  expect(() =>
    CorpusReleaseSchema.parse({
      ...raw,
      editionEvidence: [{ ...field, text: "x".repeat(501) }],
    }),
  ).toThrow();
  expect(() =>
    CorpusReleaseSchema.parse({
      ...raw,
      editionEvidence: Array.from({ length: 21 }, () => field),
    }),
  ).toThrow();
  const editionEvidence = Array.from({ length: 20 }, () => field);
  const bounded = CorpusReleaseSchema.parse({ ...raw, editionEvidence });
  const production = productionCut({
    ...stored,
    sourceEvidence: { infoHash: "a".repeat(40), editionEvidence },
  });
  expect(corpusCut(input, bounded).conclusion).toEqual(production.conclusion);
  expect(corpusCut(input, bounded).issues).toEqual(["input_limit_exceeded"]);
});

test("independent named label catches losing secondary evidence as a wrong automatic acceptance", async () => {
  const { raw } = await providerRelease(
    baseline.title,
    "The.Paper.Lantern.2024.Directors.Cut.1080p",
  );
  const labels = CorpusLabelsSchema.parse({
    schemaVersion: 1,
    authoredBy: "synthetic-fixture-author",
    basis:
      "Fictional secondary field explicitly names Director's Cut; default acquisition must reject it.",
    candidates: [
      {
        key: raw.key,
        disposition: "reject",
        coverage: ["lantern"],
        edition: "named",
        plan: null,
      },
    ],
    ranking: null,
  });
  const report = (candidate: CorpusRelease) =>
    reportCorpusCase({
      entry: descriptor,
      profile: policy,
      labels,
      input: CorpusInputSchema.parse({ ...input, candidates: [candidate] }),
    });
  const complete = await report(raw);
  expect(complete.hardFailure).toBe(false);
  const { editionEvidence: _editionEvidence, ...lost } = raw;
  const regression = await report(lost);
  expect(regression.hardFailure).toBe(true);
  expect(regression.candidates[0]?.differences).toContain("wrong_accept");
});
