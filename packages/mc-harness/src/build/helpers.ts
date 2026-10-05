import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  type BlockGrid,
  type Vec3,
} from "@shepherdjerred/mc-build/core/grid.ts";
import { ensureAssets } from "@shepherdjerred/mc-build/render/assets.ts";
import { encodePng, Renderer } from "@shepherdjerred/mc-build/render/index.ts";
import type { BlockPos } from "#protocol/bridge.ts";
import { BUILD_FILES, type BuildManifest } from "#protocol/build.ts";
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
  await mkdir(workspace.file(BUILD_FILES.rendersDir), { recursive: true });
  const out = workspace.file(path.join(BUILD_FILES.rendersDir, `${name}.png`));
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
