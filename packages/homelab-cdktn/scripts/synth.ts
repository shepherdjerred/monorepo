#!/usr/bin/env bun
/**
 * Synthesizes every cdktn stack and writes the reviewed copy to
 * `packages/homelab/src/tofu/<stack>/main.tf.json`, next to the stack's lock file.
 *
 * Synthesis runs the app in-process and never calls OpenTofu. `--check`
 * writes nothing and fails when a committed file differs from a fresh
 * synthesis, so a stack can never be planned from stale JSON.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { format } from "prettier";
import { createApp, SYNTHESIZED_STACKS } from "#src/app.ts";
import type { SynthesizedStack } from "#src/app.ts";

const TOFU_ROOT = path.resolve(import.meta.dir, "../../homelab/src/tofu");

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
