import { mkdir, open, readFile, access } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const Timestamp = z.number().int().nonnegative();
const Digest = z.string().regex(/^[a-f0-9]{64}$/u);
export const PilotConfigSchema = z
  .object({
    version: z.literal(1),
    acceptance: z.literal("unaccepted"),
    mode: z.enum(["pilot", "diagnostic"]),
    seeds: z
      .array(z.number().int().min(0).max(1_000_000_000))
      .length(3)
      .refine((seeds) => new Set(seeds).size === 3)
      .readonly(),
    seconds: z.union([z.literal(28_800), z.literal(300)]),
    device: z.enum(["cpu", "mps"]),
    dataset: z.string().min(1).nullable(),
    inputSha256: Digest,
  })
  .strict()
  .refine((config) =>
    config.mode === "pilot"
      ? config.seconds === 28_800 && config.dataset !== null
      : config.seconds === 300 && config.dataset === null,
  )
  .readonly();
export type PilotConfig = z.infer<typeof PilotConfigSchema>;
const ClaimSchema = z
  .object({
    seed: z.number().int(),
    startedMs: Timestamp,
    deadlineMs: Timestamp,
  })
  .strict();
export type Claim = z.infer<typeof ClaimSchema>;
const ResultSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("frozen"),
      completedMs: Timestamp,
      manifestSha256: Digest,
      weightsSha256: Digest,
    })
    .strict(),
  z
    .object({
      status: z.literal("failed"),
      reason: z.string().min(1),
      completedMs: Timestamp,
    })
    .strict(),
]);
export type SeedResult = z.infer<typeof ResultSchema>;

async function exists(file: string) {
  try {
    await access(file);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return false;
    throw error;
  }
}

/** Immutable writes and fsync make a seed claim survive owner crashes. */
async function exclusiveJson(file: string, value: unknown) {
  const handle = await open(file, "wx", 0o600);
  try {
    await handle.writeFile(JSON.stringify(value, null, 2) + "\n");
    await handle.sync();
  } finally {
    await handle.close();
  }
  const directory = await open(path.dirname(file), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

export class PilotLedger {
  private constructor(
    readonly output: string,
    readonly config: PilotConfig,
  ) {}

  static async create(output: string, config: PilotConfig) {
    const validated = PilotConfigSchema.parse(config);
    await mkdir(path.dirname(output), { recursive: true });
    await mkdir(output, { recursive: false });
    await exclusiveJson(path.join(output, "pilot.json"), validated);
    return new PilotLedger(output, validated);
  }

  static async read(output: string) {
    const raw: unknown = JSON.parse(
      await readFile(path.join(output, "pilot.json"), "utf8"),
    );
    return new PilotLedger(output, PilotConfigSchema.parse(raw));
  }

  private files(index: number) {
    if (!Number.isInteger(index) || index < 0 || index >= 3)
      throw new Error("invalid pilot seed index");
    return {
      claim: path.join(this.output, `seed-${index.toString()}.claimed.json`),
      result: path.join(this.output, `seed-${index.toString()}.result.json`),
    };
  }

  async state(index: number) {
    const files = this.files(index);
    if (!(await exists(files.claim))) {
      if (await exists(files.result))
        throw new Error("pilot result has no seed claim");
      return { status: "pending" as const };
    }
    const rawClaim: unknown = JSON.parse(await readFile(files.claim, "utf8"));
    const claim = ClaimSchema.parse(rawClaim);
    if (
      claim.seed !== this.config.seeds[index] ||
      claim.deadlineMs - claim.startedMs !== this.config.seconds * 1000
    )
      throw new Error("seed claim differs from original pilot budget");
    if (!(await exists(files.result)))
      return { status: "running" as const, claim };
    const rawResult: unknown = JSON.parse(await readFile(files.result, "utf8"));
    const result = ResultSchema.parse(rawResult);
    if (
      result.completedMs < claim.startedMs ||
      (result.status === "frozen" && result.completedMs > claim.deadlineMs)
    )
      throw new Error("pilot result exceeds its original budget");
    return { ...result, claim };
  }

  async claim(index: number, now: number): Promise<Claim> {
    for (let previous = 0; previous < index; previous++) {
      const state = await this.state(previous);
      if (state.status !== "frozen")
        throw new Error(
          "earlier seed is unfinished or failed; no extra training window",
        );
    }
    const state = await this.state(index);
    if (state.status !== "pending")
      throw new Error("seed already claimed; its budget cannot restart");
    const claim = ClaimSchema.parse({
      seed: this.config.seeds[index],
      startedMs: now,
      deadlineMs: now + this.config.seconds * 1000,
    });
    // Concurrent owners can both read pending; only one can create this claim.
    await exclusiveJson(this.files(index).claim, claim);
    return claim;
  }

  async finish(index: number, result: SeedResult) {
    const state = await this.state(index);
    if (state.status !== "running") throw new Error("seed is not running");
    const parsed = ResultSchema.parse(result);
    if (
      parsed.completedMs < state.claim.startedMs ||
      (parsed.status === "frozen" &&
        parsed.completedMs > state.claim.deadlineMs)
    )
      throw new Error("seed cannot freeze beyond its budget");
    await exclusiveJson(this.files(index).result, parsed);
  }
}
