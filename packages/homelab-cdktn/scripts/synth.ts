#!/usr/bin/env bun
/**
 * Synthesizes every cdktn stack and writes the reviewed copy to
 * `packages/homelab/src/tofu/<stack>/main.tf.json`, next to the stack's lock file.
 *
 * Synthesis runs the app in-process and never calls OpenTofu directly; when
 * invoked on a fresh checkout before `generated/providers` exists, it runs
 * `bunx turbo run generate --filter=@homelab/cdktn` first. `--check` writes
 * nothing to `src/tofu/` and fails when a committed file differs from a fresh
 * synthesis, so a stack can never be planned from stale JSON.
 */
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { format } from "prettier";
import type { SynthesizedStack } from "#src/app.ts";

const PACKAGE_ROOT = path.resolve(import.meta.dir, "..");
const REPOSITORY_ROOT = path.resolve(PACKAGE_ROOT, "../..");
const TOFU_ROOT = path.resolve(PACKAGE_ROOT, "../homelab/src/tofu");
const GENERATED_PROVIDERS_DIR = path.join(PACKAGE_ROOT, "generated/providers");

export const GENERATE_COMMAND =
  "bunx turbo run generate --filter=@homelab/cdktn";

export type EnsureGeneratedBindingsOptions = {
  providersDirectory?: string;
  autoGenerate?: boolean;
  runGenerate?: () => Promise<void>;
};

async function hasGeneratedProviders(directory: string): Promise<boolean> {
  try {
    const entries = await readdir(directory);
    return entries.length > 0;
  } catch {
    return false;
  }
}

async function runTurboGenerate(): Promise<void> {
  const child = Bun.spawn(
    ["bunx", "turbo", "run", "generate", "--filter=@homelab/cdktn"],
    {
      cwd: REPOSITORY_ROOT,
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(`${GENERATE_COMMAND} failed (exit ${exitCode.toString()})`);
  }
}

/**
 * Verifies `generated/providers` exists before importing `#src/app.ts`, running
 * {@link GENERATE_COMMAND} when `autoGenerate` is enabled or reporting the
 * exact prerequisite command otherwise.
 */
export async function ensureGeneratedBindings(
  options: EnsureGeneratedBindingsOptions = {},
): Promise<void> {
  const providersDirectory =
    options.providersDirectory ?? GENERATED_PROVIDERS_DIR;
  if (await hasGeneratedProviders(providersDirectory)) {
    return;
  }
  if (options.autoGenerate !== true) {
    throw new Error(
      `Missing generated CDK Terrain provider bindings at ${providersDirectory}. Run: ${GENERATE_COMMAND}`,
    );
  }
  const generate = options.runGenerate ?? runTurboGenerate;
  try {
    await generate();
  } catch (error) {
    throw new Error(
      `Failed to generate missing CDK Terrain provider bindings (${GENERATE_COMMAND}).`,
      { cause: error },
    );
  }
  if (!(await hasGeneratedProviders(providersDirectory))) {
    throw new Error(
      `Provider bindings are still missing at ${providersDirectory} after running: ${GENERATE_COMMAND}`,
    );
  }
}

async function loadApp() {
  await ensureGeneratedBindings();
  return import("#src/app.ts");
}

export function synthesizedConfigurationPath(stack: SynthesizedStack): string {
  return path.join(TOFU_ROOT, stack, "main.tf.json");
}

/**
 * cdktn records itself under "//" comment keys: its own version and backend
 * at the top, and a construct path beside every element. OpenTofu ignores
 * them, and keeping them would rewrite every committed stack on each cdktn
 * release, so a release could not be accepted on "the output is unchanged".
 */
export function withoutGeneratorMetadata(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item: unknown) => withoutGeneratorMetadata(item));
  }
  return typeof value === "object" && value !== null
    ? Object.fromEntries(
        Object.entries(value)
          .filter(([key]) => key !== "//")
          .map(([key, child]) => [key, withoutGeneratorMetadata(child)]),
      )
    : value;
}

/** Fresh synthesis of every stack, formatted as the repository formats JSON. */
export async function synthesize(): Promise<Map<SynthesizedStack, string>> {
  const { createApp, SYNTHESIZED_STACKS } = await loadApp();
  const outdir = await mkdtemp(path.join(tmpdir(), "cdktn-synth-"));
  try {
    createApp(outdir).synth();
    const result = new Map<SynthesizedStack, string>();
    for (const stack of SYNTHESIZED_STACKS) {
      const raw = await Bun.file(
        path.join(outdir, "stacks", stack, "cdk.tf.json"),
      ).text();
      const configuration = withoutGeneratorMetadata(JSON.parse(raw));
      result.set(
        stack,
        await format(JSON.stringify(configuration), { parser: "json" }),
      );
    }
    return result;
  } finally {
    await rm(outdir, { recursive: true, force: true });
  }
}

/** Stacks whose committed configuration differs from a fresh synthesis. */
export async function staleStacks(): Promise<SynthesizedStack[]> {
  const stale: SynthesizedStack[] = [];
  for (const [stack, content] of await synthesize()) {
    const file = Bun.file(synthesizedConfigurationPath(stack));
    if (!(await file.exists()) || (await file.text()) !== content) {
      stale.push(stack);
    }
  }
  return stale;
}

if (import.meta.main) {
  await ensureGeneratedBindings({ autoGenerate: true });
  if (Bun.argv.includes("--check")) {
    const stale = await staleStacks();
    if (stale.length > 0) {
      console.error(
        `Synthesized OpenTofu configuration is stale for: ${stale.join(", ")}\nRun: bun run --cwd packages/homelab-cdktn synth`,
      );
      process.exit(1);
    }
    console.log("synthesized OpenTofu configuration is current");
  } else {
    for (const [stack, content] of await synthesize()) {
      await Bun.write(synthesizedConfigurationPath(stack), content);
      console.log(`synthesized ${stack}`);
    }
  }
}
