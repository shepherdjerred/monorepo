import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BlockGrid, type Vec3 } from "#src/core/grid.ts";
import type { Box } from "#src/dsl/types.ts";
import { CompileResultSchema, type CompileJob } from "./job.ts";

const CHILD = path.join(import.meta.dirname, "child.ts");

/** Identifiers a build program may not touch: it is pure geometry. */
const FORBIDDEN = [
  /\bprocess\b/u,
  /\bBun\b/u,
  /\bfetch\s*\(/u,
  /\brequire\s*\(/u,
  /\bMath\.random\b/u,
  /\bDate\b/u,
  /\beval\s*\(/u,
  /\bnew\s+Function\b/u,
  /\bglobalThis\b/u,
];

export class BuildProgramError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BuildProgramError";
  }
}

function stripComments(source: string): string {
  return source
    .replaceAll(/\/\*[\s\S]*?\*\//gu, "")
    .replaceAll(/\/\/.*$/gmu, "");
}

/**
 * Rejects programs with runtime imports or ambient escape hatches. This is
 * for determinism and to contain accidents, not a security boundary.
 */
export function scanProgram(source: string): void {
  const imports = new Bun.Transpiler({ loader: "ts" }).scanImports(source);
  if (imports.length > 0) {
    throw new BuildProgramError(
      `Build programs may only use \`import type\`; found runtime imports of ${imports.map((entry) => entry.path).join(", ")}. Everything you need is on ctx (ctx.geo, ctx.mat, ctx.craft, ctx.site).`,
    );
  }
  const code = stripComments(source);
  for (const pattern of FORBIDDEN) {
    const match = pattern.exec(code);
    if (match !== null) {
      throw new BuildProgramError(
        `Build programs must be deterministic and self-contained; \`${match[0].trim()}\` is not allowed (use ctx.rng() for randomness).`,
      );
    }
  }
}

export type CompileOutput = {
  /** Local position of grid cell (0,0,0). */
  min: Vec3;
  grid: BlockGrid;
  /** Local boxes to clear to air before pasting. */
  clears: Box[];
  logs: string[];
  blocks: number;
};

/** Runs a build program in a child Bun process with an empty environment. */
export async function compileProgram(options: {
  program: string;
  seed: number;
  anchor: Vec3;
  site: CompileJob["site"];
  timeoutMs?: number;
}): Promise<CompileOutput> {
  const program = path.resolve(options.program);
  scanProgram(await Bun.file(program).text());
  const work = await mkdtemp(path.join(os.tmpdir(), "mc-build-"));
  try {
    const jobPath = path.join(work, "job.json");
    const out = path.join(work, "result.json");
    const job: CompileJob = {
      program,
      out,
      seed: options.seed,
      anchor: options.anchor,
      site: options.site,
    };
    await Bun.write(jobPath, JSON.stringify(job));
    const child = Bun.spawn([process.execPath, "run", CHILD, jobPath], {
      cwd: path.dirname(program),
      env: {},
      stdout: "pipe",
      stderr: "pipe",
      timeout: options.timeoutMs ?? 30_000,
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (child.signalCode !== null) {
      throw new BuildProgramError(
        `Build program timed out after ${(options.timeoutMs ?? 30_000).toString()} ms (killed with ${child.signalCode})`,
      );
    }
    if (exitCode !== 0) {
      throw new BuildProgramError(
        `Build program failed (exit ${exitCode.toString()}):\n${(stderr || stdout).trim()}`,
      );
    }
    const result = CompileResultSchema.parse(await Bun.file(out).json());
    const bytes = Buffer.from(result.data, "base64");
    const indices = new Uint32Array(bytes.length / 4);
    for (let index = 0; index < indices.length; index += 1) {
      indices[index] = bytes.readUInt32LE(index * 4);
    }
    return {
      min: result.min,
      grid: BlockGrid.fromIndices(result.size, result.palette, indices),
      clears: result.clears,
      logs: result.logs,
      blocks: result.blocks,
    };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
