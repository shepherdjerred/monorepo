#!/usr/bin/env bun
// Which way does each champion face in its splash art? One structured vision
// call per image, written to assets/champion-splash-facing.json so presentation
// code can mirror splashes deterministically (see `splashPresentation`).
//
// Entries are keyed by the image's sha256: an unchanged image is never sent
// again, a changed image is reclassified, and an entry whose splash is gone is
// pruned. A model failure throws; nothing defaults silently. Progress is saved
// before the error propagates so a re-run resumes where it stopped.
//
//   op run --env-file=<file with ANTHROPIC_API_KEY> -- \
//     bun run classify-splash-facing [--max-cost-usd 5] [--concurrency 4]

import path from "node:path";
import { z } from "zod";
import {
  createLlmRuntime,
  generateValidatedObject,
  providerCredentialsFromEnv,
  requireCredentialsFor,
  StructuredOutputUsageError,
} from "@shepherdjerred/llm-runtime";
import {
  ChampionSplashFacingSchema,
  SplashFacingClassificationSchema,
  type ChampionSplashFacing,
  type ChampionSplashFacingEntry,
  type SplashFacingClassification,
} from "#src/data-dragon/champion-splash-facing.ts";

const MODEL = "claude-sonnet-5-5";
const TIMEOUT_MS = 120_000;
export const DEFAULT_MAX_COST_USD = 5;
const DEFAULT_CONCURRENCY = 4;
// Per-call reservation until a real call reports its cost; after that the most
// expensive call seen so far, so the hard stop holds under concurrency.
const INITIAL_CALL_COST_ESTIMATE_USD = 0.03;

const ASSETS_DIR = path.resolve(import.meta.dir, "../src/data-dragon/assets");
const SPLASH_DIR = path.resolve(ASSETS_DIR, "img/champion-splash");
const OUTPUT_PATH = path.resolve(ASSETS_DIR, "champion-splash-facing.json");
const CHAMPION_PATH = path.resolve(ASSETS_DIR, "champion.json");

const ChampionNamesSchema = z.object({
  data: z.record(z.string(), z.object({ name: z.string() })),
});

export function buildFacingPrompt(input: {
  championName: string;
  classic: boolean;
}): string {
  return [
    `This is the splash art for the League of Legends champion ${input.championName}${input.classic ? " (League Classic era art)" : ""}.`,
    "The page that shows it may place the champion on the left or right and",
    "mirror the image so the champion looks toward the middle, so describe the",
    "image exactly as the viewer sees it.",
    "",
    "Fill in:",
    '- facing: the direction the champion\'s face and body point as the viewer sees the image. "left" means toward the image\'s left edge, "right" toward its right edge, "center" only when the champion is square to the camera within about 15 degrees, or the face is hidden and the body has no lean. A face that turns even slightly to one side, a gaze toward one side, or a body that leans that way is "left" or "right"; pick the side it turns toward and lower the confidence if it is subtle. Judge the champion named above, not background figures or companions. Where face and body disagree, use the face.',
    "- focusX: horizontal position of the champion's face (center of the head) as a fraction of image width, 0 at the left edge, 1 at the right edge.",
    "- mirrorSafe: false only when flipping the image horizontally would visibly break it: readable text, lettering, numerals, a logo or watermark, or a prominent symbol or emblem whose mirror image is wrong. Facial markings, tattoos, scars, hair, clothing, held-item handedness, and the side a pose leans toward are NOT reasons; art is routinely mirrored. True otherwise.",
    '- confidence: "high" when facing is unambiguous, "medium" when plausible but debatable, "low" when you would want a person to check it.',
    "- note: one short sentence naming what drove the facing or mirrorSafe call when it was not obvious; an empty string when it was.",
  ].join("\n");
}

type CostLedger = {
  spentUsd: number;
  maxObservedCallUsd: number;
  inFlight: number;
};

function reservedUsd(ledger: CostLedger): number {
  const perCall =
    ledger.maxObservedCallUsd > 0
      ? ledger.maxObservedCallUsd
      : INITIAL_CALL_COST_ESTIMATE_USD;
  return ledger.spentUsd + (ledger.inFlight + 1) * perCall;
}

function charge(ledger: CostLedger, costUsd: number): void {
  ledger.spentUsd += costUsd;
  ledger.maxObservedCallUsd = Math.max(ledger.maxObservedCallUsd, costUsd);
}

function sha256Hex(bytes: Uint8Array): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(bytes);
  return hasher.digest("hex");
}

export type SplashFile = {
  file: string;
  championKey: string;
  imageSha256: string;
};

async function readSplashFiles(): Promise<SplashFile[]> {
  const files: SplashFile[] = [];
  for await (const file of new Bun.Glob("*_0.jpg").scan({ cwd: SPLASH_DIR })) {
    const bytes = new Uint8Array(
      await Bun.file(path.resolve(SPLASH_DIR, file)).arrayBuffer(),
    );
    files.push({
      file,
      championKey: file.slice(0, -"_0.jpg".length),
      imageSha256: sha256Hex(bytes),
    });
  }
  return files.toSorted((a, b) => a.file.localeCompare(b.file));
}

export type SplashFacingPlan = {
  /** Existing entries still describing their image. */
  keep: Record<string, ChampionSplashFacingEntry>;
  /** Splashes with no entry, or whose bytes changed. */
  pending: SplashFile[];
  /** Entries for splashes that no longer exist. */
  pruned: string[];
};

export function planSplashFacing(
  existing: ChampionSplashFacing,
  splashes: readonly SplashFile[],
): SplashFacingPlan {
  const onDisk = new Set(splashes.map((splash) => splash.file));
  const keep: Record<string, ChampionSplashFacingEntry> = {};
  const pending: SplashFile[] = [];
  for (const splash of splashes) {
    const entry = existing.entries[splash.file];
    if (entry?.imageSha256 === splash.imageSha256) {
      keep[splash.file] = entry;
    } else {
      pending.push(splash);
    }
  }
  const pruned = Object.keys(existing.entries).filter(
    (file) => !onDisk.has(file),
  );
  return { keep, pending, pruned };
}

function chargeFromError(ledger: CostLedger, error: unknown): void {
  if (error instanceof StructuredOutputUsageError) {
    charge(ledger, error.usage.catalogCostUsd);
  }
}

async function classifyOne(input: {
  runtime: ReturnType<typeof createLlmRuntime>;
  splash: SplashFile;
  championName: string;
  ledger: CostLedger;
}): Promise<SplashFacingClassification> {
  const { splash, ledger } = input;
  const bytes = new Uint8Array(
    await Bun.file(path.resolve(SPLASH_DIR, splash.file)).arrayBuffer(),
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error(`Splash facing timed out for ${splash.file}`));
  }, TIMEOUT_MS);
  try {
    const result = await generateValidatedObject(input.runtime, {
      model: MODEL,
      prompt: buildFacingPrompt({
        championName: input.championName,
        classic: splash.championKey.startsWith("Jade_"),
      }),
      images: [{ data: bytes, mediaType: "image/jpeg" }],
      schema: SplashFacingClassificationSchema,
      schemaName: "scout_splash_facing",
      workload: "scout.splash-facing",
      reasoningEffort: "low",
      abortSignal: controller.signal,
    });
    charge(ledger, result.usage.catalogCostUsd);
    return result.object;
  } catch (error: unknown) {
    chargeFromError(ledger, error);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export type ClassifySummary = {
  classified: number;
  skipped: number;
  pruned: number;
  costUsd: number;
};

/**
 * Classify every splash that lacks a current entry and write the result.
 * Throws when the cost cap would be exceeded or any call fails, after saving
 * everything classified so far.
 */
export async function classifySplashFacing(
  options: {
    maxCostUsd?: number;
    concurrency?: number;
    log?: (line: string) => void;
  } = {},
): Promise<ClassifySummary> {
  const maxCostUsd = options.maxCostUsd ?? DEFAULT_MAX_COST_USD;
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const log = options.log ?? console.log;

  const existing = ChampionSplashFacingSchema.parse(
    await Bun.file(OUTPUT_PATH).json(),
  );
  const splashes = await readSplashFiles();
  const plan = planSplashFacing(existing, splashes);
  const entries = { ...plan.keep };
  const ledger: CostLedger = {
    spentUsd: 0,
    maxObservedCallUsd: 0,
    inFlight: 0,
  };

  const save = async (): Promise<void> => {
    const sorted = Object.fromEntries(
      Object.entries(entries).toSorted(([a], [b]) => a.localeCompare(b)),
    );
    const document: ChampionSplashFacing = { version: 1, entries: sorted };
    await Bun.write(OUTPUT_PATH, `${JSON.stringify(document, undefined, 2)}\n`);
  };

  log(
    `Splash facing: ${String(plan.pending.length)} to classify, ${String(Object.keys(plan.keep).length)} up to date, ${String(plan.pruned.length)} pruned`,
  );
  if (plan.pending.length === 0) {
    if (plan.pruned.length > 0) await save();
    return {
      classified: 0,
      skipped: Object.keys(plan.keep).length,
      pruned: plan.pruned.length,
      costUsd: 0,
    };
  }

  const credentials = providerCredentialsFromEnv();
  requireCredentialsFor(MODEL, credentials);
  const runtime = createLlmRuntime({
    credentials,
    service: "scout-data",
    appName: "scout-splash-facing/1.0",
  });
  const names = ChampionNamesSchema.parse(await Bun.file(CHAMPION_PATH).json());

  const queue = [...plan.pending];
  let failure: Error | undefined;
  let classified = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      if (failure !== undefined) return;
      const splash = queue.shift();
      if (splash === undefined) return;
      if (reservedUsd(ledger) > maxCostUsd) {
        failure = new Error(
          `Splash facing stopped: spent $${ledger.spentUsd.toFixed(3)} and the next call could pass --max-cost-usd ${String(maxCostUsd)}; ${String(queue.length + 1)} splash(es) left (re-run to resume)`,
        );
        return;
      }
      ledger.inFlight += 1;
      try {
        const championName =
          names.data[splash.championKey]?.name ?? splash.championKey;
        const result = await classifyOne({
          runtime,
          splash,
          championName,
          ledger,
        });
        entries[splash.file] = {
          ...result,
          imageSha256: splash.imageSha256,
          source: "model",
        };
        classified += 1;
        if (classified % 20 === 0) {
          log(
            `  ${String(classified)}/${String(plan.pending.length)} classified, $${ledger.spentUsd.toFixed(3)} spent`,
          );
        }
      } catch (error: unknown) {
        failure ??= new Error(
          `Splash facing failed for ${splash.file}: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      } finally {
        ledger.inFlight -= 1;
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  await save();
  log(
    `Splash facing: classified ${String(classified)}, cost $${ledger.spentUsd.toFixed(4)} of $${String(maxCostUsd)} cap`,
  );
  if (failure !== undefined) throw failure;
  return {
    classified,
    skipped: Object.keys(plan.keep).length,
    pruned: plan.pruned.length,
    costUsd: ledger.spentUsd,
  };
}

function numberFlag(name: string): number | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = Number(process.argv[index + 1]);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} needs a positive number`);
  }
  return value;
}

if (import.meta.main) {
  const maxCostUsd = numberFlag("--max-cost-usd");
  const concurrency = numberFlag("--concurrency");
  await classifySplashFacing({
    ...(maxCostUsd === undefined ? {} : { maxCostUsd }),
    ...(concurrency === undefined ? {} : { concurrency }),
  });
}
