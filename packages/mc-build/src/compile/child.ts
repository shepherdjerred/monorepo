/**
 * Compile child: runs one build program in a separate Bun process (spawned
 * by runner.ts with an empty environment and a timeout) and writes the
 * resulting grid as JSON. argv: <job.json>
 */
import path from "node:path";
import { z } from "zod";
import { readSchematic } from "#src/core/schem.ts";
import { SiteInfoSchema } from "#src/core/site.ts";
import {
  createBuildContext,
  siteView,
  type BuildProgram,
} from "#src/dsl/context.ts";
import type { Site } from "#src/dsl/types.ts";
import { loadRegistry } from "#src/registry/registry.ts";
import { CompileJobSchema, CompileResultSchema } from "./job.ts";

const ProgramModuleSchema = z.object({
  default: z.custom<BuildProgram>((value) => typeof value === "function", {
    message: "must `export default` a build program function ((ctx) => { … })",
  }),
});

const jobPath = Bun.argv[2];
if (jobPath === undefined) {
  throw new Error("usage: child.ts <job.json>");
}
const job = CompileJobSchema.parse(await Bun.file(jobPath).json());
const registry = await loadRegistry();
let site: Site | null = null;
if (job.site !== null) {
  const info = SiteInfoSchema.parse(await Bun.file(job.site.info).json());
  const schematic = await readSchematic(
    new Uint8Array(await Bun.file(job.site.schematic).arrayBuffer()),
  );
  site = siteView(info, schematic.grid, job.anchor);
}
const logs: string[] = [];
const { ctx, canvas } = createBuildContext({
  registry,
  seed: job.seed,
  site,
  log: (message) => {
    logs.push(message);
  },
});
const loaded = ProgramModuleSchema.safeParse(
  await import(path.resolve(job.program)),
);
if (!loaded.success) {
  throw new Error(
    `${job.program} ${loaded.error.issues.map((issue) => issue.message).join("; ")}`,
  );
}
await loaded.data.default(ctx);
const compiled = canvas.compile();
const { grid } = compiled;
const data = Buffer.alloc(grid.data.length * 4);
grid.data.forEach((value, index) => {
  data.writeUInt32LE(value, index * 4);
});
await Bun.write(
  job.out,
  JSON.stringify(
    CompileResultSchema.parse({
      min: compiled.min,
      size: grid.size,
      palette: grid.palette,
      data: data.toString("base64"),
      clears: compiled.clears,
      logs,
      blocks: canvas.size,
    }),
  ),
);
