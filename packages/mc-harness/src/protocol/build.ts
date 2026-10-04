/**
 * Build workspaces: a directory holding `build.json` (the manifest), an
 * ordered, replayable op log (`build.oplog.json`), the captured site, and
 * pasted schematics. Every op carries explicit coordinates, so the log replays
 * identically on a canvas, a fresh sandbox, or (later) live.
 */
import path from "node:path";
import { z } from "zod";
import { BlockPosSchema, RotationSchema, SessionNameSchema } from "./bridge.ts";

export const BUILD_FILES = {
  manifest: "build.json",
  oplog: "build.oplog.json",
  program: "build.ts",
  siteDir: "site",
  siteSchematic: path.join("site", "site.schem"),
  siteInfo: path.join("site", "site.json"),
  expected: "expected.json",
  /** Frozen canvas result (bridge snapshot of the site box); promote pastes it. */
  expectedSchematic: "expected.schem",
  schematicsDir: "schematics",
  rendersDir: "renders",
} as const;

export const WeOpLogSchema = z.strictObject({
  kind: z.literal("we"),
  world: z.string().min(1),
  command: z.string().regex(/^\/\//u),
  pos1: BlockPosSchema.optional(),
  pos2: BlockPosSchema.optional(),
  at: BlockPosSchema.optional(),
  /** Who produced the op: "manual" (recorded from the CLI) or "program:<sha>". */
  source: z.string(),
});
export const PasteOpLogSchema = z.strictObject({
  kind: z.literal("paste"),
  world: z.string().min(1),
  /** Path relative to the build directory, e.g. schematics/<sha>.schem. */
  schematic: z.string().min(1),
  at: BlockPosSchema,
  rotate: RotationSchema,
  ignoreAir: z.boolean(),
  source: z.string(),
});
export const CommandOpLogSchema = z.strictObject({
  kind: z.literal("command"),
  command: z.string().min(1),
  source: z.string(),
});
export const OpSchema = z.discriminatedUnion("kind", [
  WeOpLogSchema,
  PasteOpLogSchema,
  CommandOpLogSchema,
]);
export type Op = z.infer<typeof OpSchema>;

export const OpLogSchema = z.strictObject({
  version: z.literal(1),
  ops: z.array(OpSchema),
});
export type OpLog = z.infer<typeof OpLogSchema>;

export const BuildManifestSchema = z.strictObject({
  version: z.literal(1),
  name: SessionNameSchema,
  world: z.string().min(1),
  /** World position of build-local (0,0,0) for build.ts programs (front faces south). */
  anchor: BlockPosSchema,
  seed: z.number().int(),
  /** Captured site box; the canvas, replays and promotions all operate inside it. */
  site: z
    .strictObject({
      min: BlockPosSchema,
      max: BlockPosSchema,
      siteHash: z.string(),
    })
    .optional(),
  /** Sandbox id of the canvas seeded from the site. */
  canvas: z.string().optional(),
});
export type BuildManifest = z.infer<typeof BuildManifestSchema>;

/** Reads a build directory's op log (an empty log when the file is absent). */
export async function readOpLog(dir: string): Promise<OpLog> {
  const file = Bun.file(path.join(dir, BUILD_FILES.oplog));
  return (await file.exists())
    ? OpLogSchema.parse(await file.json())
    : { version: 1, ops: [] };
}

export async function writeOpLog(dir: string, log: OpLog): Promise<void> {
  await Bun.write(
    path.join(dir, BUILD_FILES.oplog),
    `${JSON.stringify(OpLogSchema.parse(log), null, 2)}\n`,
  );
}

/** Appends one op that already succeeded against a target. */
export async function appendOp(dir: string, op: Op): Promise<number> {
  if (!(await Bun.file(path.join(dir, BUILD_FILES.manifest)).exists())) {
    throw new Error(
      `${dir} is not a build directory (no ${BUILD_FILES.manifest}); run toolkit mc build init first`,
    );
  }
  const log = await readOpLog(dir);
  log.ops.push(OpSchema.parse(op));
  await writeOpLog(dir, log);
  return log.ops.length;
}
