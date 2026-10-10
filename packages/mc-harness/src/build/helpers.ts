import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  type BlockGrid,
  type Vec3,
} from "@shepherdjerred/mc-build/core/grid.ts";
import { writeSchematic } from "@shepherdjerred/mc-build/core/schem.ts";
import { gridHash } from "@shepherdjerred/mc-build/core/site.ts";
import { lintGrid } from "@shepherdjerred/mc-build/lint/lint.ts";
import { loadRegistry } from "@shepherdjerred/mc-build/registry/registry.ts";
import { ensureAssets } from "@shepherdjerred/mc-build/render/assets.ts";
import {
  cropGrid as cropBox,
  cutGrid,
  namedCrop,
  type CropName,
} from "@shepherdjerred/mc-build/render/cut.ts";
import {
  assertTexturesPresent,
  encodePng,
  Renderer,
  wantsHero,
  withoutSky,
  type RenderContextOptions,
} from "@shepherdjerred/mc-build/render/index.ts";
import type { Image } from "@shepherdjerred/mc-build/render/raster.ts";
import type { RenderMode } from "@shepherdjerred/mc-build/render/sheet.ts";
import type { BlockPos } from "#protocol/bridge.ts";
import {
  BUILD_FILES,
  type BuildLogEntry,
  type BuildManifest,
  type RenderSidecar,
} from "#protocol/build.ts";
import { iterationOf, readLog } from "./build-log.ts";
import { programBehind, readProgramText, writeSidecar } from "./sidecar.ts";
import type { DaemonClient } from "./daemon-client.ts";
import type { Journal } from "./journal.ts";
import { resetToSite, type RunContext } from "./ops.ts";
import { BuildWorkspace } from "./workspace.ts";

export const PROGRAM_TEMPLATE = `import type { BuildProgram } from "@shepherdjerred/mc-build/dsl/context.ts";

/**
 * Build program: local frame +x right, +y up, +z toward the front (south at
 * rotate 0). (0,0,0) is the manifest anchor. Boxes are {x, y, z, w, h, d}.
 * Run \`toolkit mc build compile <dir>\` to turn this into a paste op.
 */
export default ((ctx) => {
  const { craft, mat } = ctx;
  const theme = mat.theme("medieval");
  const fp = { x: 0, z: 0, w: 9, d: 7 };
  const base = craft.foundation({ ...fp, y: 0, material: theme.foundation });
  const walls = craft.walls({ ...fp, y: base.top, h: 4, frame: theme.frame, infill: theme.infill });
  craft.door(walls.faces.front, { at: 4, door: theme.door });
  craft.gableRoof({ ...fp, y: walls.top, ridge: "x", stairs: theme.roof, gable: theme.trim, eaves: true });
}) satisfies BuildProgram;
`;

export type Env = {
  client: DaemonClient;
  journal: Journal;
  log: (message: string) => void;
};

export function plus(a: BlockPos, b: Vec3): BlockPos {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function sha(bytes: Uint8Array | string, length = 16): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, length);
}

export function context(
  env: Env,
  workspace: BuildWorkspace,
  manifest: BuildManifest,
  target: string,
): RunContext {
  return {
    client: env.client,
    target,
    workspace,
    session: BuildWorkspace.session(manifest),
  };
}

export function canvasOf(
  manifest: BuildManifest,
  explicit: string | undefined,
): string {
  const target = explicit ?? manifest.canvas;
  if (target === undefined) {
    throw new Error(
      "No target: pass --target <sandbox> or create a canvas with toolkit mc build canvas <dir>",
    );
  }
  return target;
}

export async function renderGrid(
  workspace: BuildWorkspace,
  grid: BlockGrid,
  name: string,
  title: string,
): Promise<string> {
  const renderer = new Renderer(
    await ensureAssets(undefined, (message) => {
      console.error(message);
    }),
  );
  const image = await renderer.sheet(grid, { title, subtitle: name });
  assertTexturesPresent(renderer, `render ${name}`);
  await mkdir(workspace.file(BUILD_FILES.rendersDir), { recursive: true });
  const out = workspace.file(path.join(BUILD_FILES.rendersDir, `${name}.png`));
  await Bun.write(out, await encodePng(image));
  return out;
}

export type LookView = "sheet" | "elevations" | "hero" | "pov" | "survey";

/** Everything `build render` can be asked to look at beyond the default sheet. */
export type LookOptions = {
  mode?: RenderMode;
  views?: readonly LookView[];
  /** Coordinate lines every n blocks on plans and elevations. */
  grid?: number;
  /** Floor plan: keep cells at or below this local y. */
  floor?: number;
  /** Section: keep cells at or behind this local z (the front, +z, half is removed). */
  section?: number;
  crop?: CropName;
  /** An earlier render's grid (its `.schem` sidecar) to show beside this one. */
  compareWith?: BlockGrid;
  /** Recorded in the sidecar: canvas, expected or compiled. */
  source?: string;
  /** Exact sandbox read for a canvas render; defaults to the manifest canvas. */
  target?: string;
  /** World box the grid covers, recorded in the sidecar so a later `--compare` can align to it. */
  box?: { min: BlockPos; max: BlockPos };
};

async function writeLook(
  workspace: BuildWorkspace,
  file: string,
  image: Image,
): Promise<string> {
  const out = workspace.file(path.join(BUILD_FILES.rendersDir, file));
  await Bun.write(out, await encodePng(image));
  return out;
}

/**
 * The grid a look is drawn from, cropped and cut as asked, and the grid it
 * is lit by: the whole build, with the crop's origin retained so every
 * floor or section samples the original roof, walls, openings and lamps.
 */
function subjectOf(
  grid: BlockGrid,
  options: LookOptions,
): {
  subject: BlockGrid;
  lightFrom: BlockGrid;
  lightOrigin: Vec3;
  cropFrom?: NonNullable<RenderContextOptions["cropFrom"]>;
} {
  // Deliberate sections expose new surfaces; a close-up only crops the geometry.
  const geometry =
    options.floor !== undefined || options.section !== undefined
      ? cutGrid(grid, {
          ...(options.floor === undefined ? {} : { belowY: options.floor }),
          ...(options.section === undefined
            ? {}
            : { behindZ: options.section }),
        })
      : grid;
  let subject = geometry;
  let origin = { x: 0, y: 0, z: 0 };
  if (options.crop !== undefined) {
    const box = namedCrop(grid, options.crop);
    subject = cropBox(geometry, box);
    origin = {
      x: Math.max(0, box.min.x),
      y: Math.max(0, box.min.y),
      z: Math.max(0, box.min.z),
    };
  }
  return {
    subject,
    lightFrom: grid,
    lightOrigin: origin,
    ...(options.crop === undefined
      ? {}
      : {
          cropFrom: {
            grid: geometry,
            box: {
              min: origin,
              max: {
                x: origin.x + subject.size.x - 1,
                y: origin.y + subject.size.y - 1,
                z: origin.z + subject.size.z - 1,
              },
            },
          },
        }),
  };
}

type LookContext = {
  renderer: Renderer;
  subject: BlockGrid;
  whole: BlockGrid;
  name: string;
  mode: RenderMode;
  grid: number | undefined;
  /** Lighting stays in whole-build coordinates even for cropped/cut subjects. */
  lightFrom: BlockGrid;
  lightOrigin: Vec3;
  cropFrom: RenderContextOptions["cropFrom"];
};

type LookRenderer = (ctx: LookContext) => Promise<[string, string, Image][]>;

const LOOKS: Record<LookView, LookRenderer> = {
  sheet: async (ctx) => [
    [
      "sheet",
      `${ctx.name}.png`,
      await ctx.renderer.sheet(ctx.subject, {
        title: ctx.name,
        subtitle:
          ctx.mode === "textured" ? ctx.name : `${ctx.name} - ${ctx.mode}`,
        mode: ctx.mode,
        ...(ctx.grid === undefined ? {} : { grid: ctx.grid }),
        lightFrom: ctx.lightFrom,
        lightOrigin: ctx.lightOrigin,
        ...(ctx.cropFrom === undefined ? {} : { cropFrom: ctx.cropFrom }),
      }),
    ],
  ],
  elevations: async (ctx) => [
    [
      "elevations",
      `${ctx.name}-elevations.png`,
      await ctx.renderer.elevations(ctx.subject, {
        mode: ctx.mode,
        grid: ctx.grid ?? 8,
        lightFrom: ctx.lightFrom,
        lightOrigin: ctx.lightOrigin,
        ...(ctx.cropFrom === undefined ? {} : { cropFrom: ctx.cropFrom }),
      }),
    ],
  ],
  hero: async (ctx) => [
    [
      "hero",
      `${ctx.name}-hero.png`,
      await ctx.renderer.view(
        withoutSky(ctx.subject),
        "iso-front-right",
        1400,
        {
          mode: ctx.mode,
          ...(ctx.grid === undefined ? {} : { grid: ctx.grid }),
          lightFrom: ctx.lightFrom,
          lightOrigin: ctx.lightOrigin,
          ...(ctx.cropFrom === undefined ? {} : { cropFrom: ctx.cropFrom }),
        },
      ),
    ],
  ],
  pov: async (ctx) => [
    [
      "pov",
      `${ctx.name}-pov.png`,
      await ctx.renderer.pov(ctx.subject, {
        mode: ctx.mode,
        lightFrom: ctx.lightFrom,
        lightOrigin: ctx.lightOrigin,
        ...(ctx.cropFrom === undefined ? {} : { cropFrom: ctx.cropFrom }),
      }),
    ],
  ],
  survey: async (ctx) => {
    const survey = await ctx.renderer.survey(ctx.subject, {
      mode: ctx.mode,
      lightFrom: ctx.lightFrom,
      lightOrigin: ctx.lightOrigin,
      ...(ctx.cropFrom === undefined ? {} : { cropFrom: ctx.cropFrom }),
    });
    return [
      ["survey-index", `${ctx.name}-survey-index.png`, survey.index],
      ...survey.tiles.map((tile): [string, string, Image] => [
        `survey-${tile.name}`,
        `${ctx.name}-survey-${tile.name}.png`,
        tile.image,
      ]),
    ];
  },
};

/**
 * Renders the looks asked for and returns each file by view name, then
 * records the render (`recordRender`). Cuts and crops apply to every view;
 * `light` reads the whole build so a cut interior is not lit as open sky.
 */
export async function renderLooks(
  workspace: BuildWorkspace,
  grid: BlockGrid,
  name: string,
  options: LookOptions,
): Promise<Record<string, string>> {
  const source = options.source ?? "canvas";
  const provenance = await readRenderProvenance(
    workspace,
    source,
    options.target,
  );
  const renderer = new Renderer(await ensureAssets());
  await mkdir(workspace.file(BUILD_FILES.rendersDir), { recursive: true });
  const { subject, lightFrom, lightOrigin, cropFrom } = subjectOf(
    grid,
    options,
  );
  const ctx: LookContext = {
    renderer,
    subject,
    whole: grid,
    name,
    mode: options.mode ?? "textured",
    grid: options.grid,
    lightFrom,
    lightOrigin,
    cropFrom,
  };
  const views = options.views ?? [
    "sheet",
    ...(wantsHero(subject) ? ["hero" as const] : []),
  ];
  const files: Record<string, string> = {};
  const looks: [string, string, Image][] = [];
  for (const view of views) {
    looks.push(...(await LOOKS[view](ctx)));
  }
  if (options.compareWith !== undefined) {
    // The same crop and cuts as the other looks, so the change plan covers
    // what the panels show and nothing that was cut away.
    const before = subjectOf(options.compareWith, options);
    const image = await renderer.compare(before.subject, subject, {
      beforeContext: before,
      afterContext: {
        lightFrom,
        lightOrigin,
        ...(cropFrom === undefined ? {} : { cropFrom }),
      },
    });
    looks.push(["compare", `${name}-compare.png`, image]);
  }
  assertTexturesPresent(renderer, `render ${name}`);
  for (const [key, file, image] of looks) {
    files[key] = await writeLook(workspace, file, image);
  }
  await recordRender(workspace, grid, {
    name,
    files,
    source,
    provenance,
    ...(options.box === undefined ? {} : { box: options.box }),
  });
  return files;
}

type RenderProvenance = {
  journal: BuildLogEntry[];
  programText: string | null;
};

/** Read all required program evidence before replacing any render artifact. */
export async function readRenderProvenance(
  workspace: BuildWorkspace,
  source: string,
  target?: string,
): Promise<RenderProvenance> {
  const journal = await readLog(workspace.dir);
  const oplog = await workspace.oplog();
  let renderedTarget = target;
  if (source === "canvas" && renderedTarget === undefined) {
    const manifest = await workspace.manifest();
    renderedTarget = manifest.canvas;
  }
  const producer = await programBehind(workspace, {
    source,
    ...(renderedTarget === undefined ? {} : { target: renderedTarget }),
    ops: oplog.ops,
    journal,
  });
  return {
    journal,
    programText:
      producer === null ? null : await readProgramText(workspace, producer),
  };
}

/**
 * Keeps what a render was of: the grid itself as `renders/<name>.schem` (so
 * a later render can compare against it and a critique can re-render it),
 * the program that produced it as `renders/<name>.build.ts` (the snapshot
 * `compile` kept, chosen for the source by `programBehind`, so a critique
 * reviews the code behind the picture and never a later compile), and
 * the sidecar `renders/<name>.json` with the files, lint summary and grid
 * hash, paths relative to the build directory.
 */
export async function recordRender(
  workspace: BuildWorkspace,
  grid: BlockGrid,
  input: {
    name: string;
    files: Record<string, string>;
    source: string;
    provenance: RenderProvenance;
    box?: { min: BlockPos; max: BlockPos };
  },
): Promise<void> {
  const registry = await loadRegistry();
  await mkdir(workspace.file(BUILD_FILES.rendersDir), { recursive: true });
  await Bun.write(
    workspace.file(path.join(BUILD_FILES.rendersDir, `${input.name}.schem`)),
    writeSchematic(grid, registry.dataVersion),
  );
  const lint = lintGrid(grid, { registry });
  const { journal, programText } = input.provenance;
  const programCopy = path.join(
    BUILD_FILES.rendersDir,
    `${input.name}.build.ts`,
  );
  if (programText !== null) {
    await Bun.write(workspace.file(programCopy), programText);
  }
  const sidecar: RenderSidecar = {
    name: input.name,
    at: new Date().toISOString(),
    iteration: iterationOf(journal) + 1,
    source: input.source,
    files: relativeFiles(workspace, input.files),
    gridHash: gridHash(grid),
    size: grid.size,
    ...(input.box === undefined ? {} : { box: input.box }),
    blocks: lint.stats.blocks,
    program: programText === null ? null : programCopy,
    lint: {
      errors: lint.errors,
      warnings: lint.warnings,
      codes: [
        ...new Set(lint.findings.map((finding) => finding.code)),
      ].toSorted(),
    },
  };
  await writeSidecar(workspace, sidecar);
}

/** The same file map with paths relative to the build directory. */
export function relativeFiles(
  workspace: BuildWorkspace,
  files: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(files).map(([key, file]) => [
      key,
      path.relative(workspace.dir, file),
    ]),
  );
}

/** The large isometric view of a map-scale grid, or null for small builds. */
export async function renderHero(
  workspace: BuildWorkspace,
  grid: BlockGrid,
  name: string,
): Promise<string | null> {
  if (!wantsHero(grid)) {
    return null;
  }
  const renderer = new Renderer(await ensureAssets());
  const out = workspace.file(
    path.join(BUILD_FILES.rendersDir, `${name}-hero.png`),
  );
  const image = await renderer.hero(grid);
  assertTexturesPresent(renderer, `hero ${name}`);
  await Bun.write(out, await encodePng(image));
  return out;
}

export async function seededSandbox(
  env: Env,
  workspace: BuildWorkspace,
  manifest: BuildManifest,
  ttlSeconds: number,
): Promise<string> {
  env.log("booting a void sandbox…");
  const sandbox = await env.client.createSandbox({
    profile: "paper",
    world: "void",
    ttlSeconds,
    keep: false,
  });
  await resetToSite(
    context(env, workspace, manifest, sandbox.id),
    workspace.siteBox(manifest),
  );
  return sandbox.id;
}
