import path from "node:path";
import { createHash } from "node:crypto";
import { open, realpath } from "node:fs/promises";
import {
  CorpusManifestSchema,
  CorpusInputSchema,
  CorpusLabelsSchema,
  type CorpusCase,
} from "./contract.ts";
import { corpusProfile } from "./replay.ts";

const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
async function readJson(filename: string) {
  const file = await open(filename, "r");
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > MAX_ARTIFACT_BYTES)
      throw new Error("Corpus artifact is not a bounded regular file");
    const bytes = await file.readFile();
    if (bytes.length !== stat.size)
      throw new Error("Corpus artifact changed while reading");
    return {
      sha256: createHash("sha256").update(bytes).digest("hex"),
      raw: JSON.parse(bytes.toString("utf8")) as unknown,
    };
  } finally {
    await file.close();
  }
}

/** Explicit local artifact only; no directory discovery, network capture or credential lookup. */
export async function loadCorpus(manifestPath: string) {
  const filename = await realpath(path.resolve(manifestPath));
  const root = path.dirname(filename);
  const manifestArtifact = await readJson(filename);
  const manifest = CorpusManifestSchema.parse(manifestArtifact.raw);
  async function artifact(reference: CorpusCase["input"]) {
    const target = await realpath(path.resolve(root, reference.path));
    const relative = path.relative(root, target);
    if (
      relative === "" ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    )
      throw new Error(
        "Corpus artifact escaped its explicit manifest directory",
      );
    const result = await readJson(target);
    if (result.sha256 !== reference.sha256)
      throw new Error("Corpus artifact literal SHA256 changed");
    return result.raw;
  }
  async function readCase(entry: CorpusCase) {
    const input = CorpusInputSchema.parse(await artifact(entry.input));
    const labels = CorpusLabelsSchema.parse(await artifact(entry.labels));
    const candidateKeys = input.candidates
      .map((candidate) => candidate.key)
      .sort();
    if (
      JSON.stringify(candidateKeys) !==
      JSON.stringify(labels.candidates.map((candidate) => candidate.key).sort())
    )
      throw new Error(
        "Independent corpus labels do not cover every candidate exactly once",
      );
    const catalogKeys = new Set(input.catalog.map((item) => item.key));
    if (
      labels.candidates.some(
        (label) =>
          label.coverage.some((key) => !catalogKeys.has(key)) ||
          (label.plan?.some((plan) =>
            plan.coverage.some((key) => !catalogKeys.has(key)),
          ) ??
            false),
      ) ||
      (labels.ranking?.some((key) => !candidateKeys.includes(key)) ?? false)
    )
      throw new Error(
        "Corpus labels reference an absent catalog record or candidate",
      );
    return {
      entry,
      input,
      labels,
      profile: corpusProfile(
        entry.profile,
        await artifact(entry.profile.artifact),
      ),
    };
  }
  return { manifest, manifestHash: manifestArtifact.sha256, readCase };
}
export type LoadedCorpusCase = Awaited<
  ReturnType<Awaited<ReturnType<typeof loadCorpus>>["readCase"]>
>;
