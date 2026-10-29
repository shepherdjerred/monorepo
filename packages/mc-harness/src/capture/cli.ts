import { parseArgs } from "node:util";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { MC_DIR } from "#protocol/paths.ts";
import {
  ClientStatusResponseSchema,
  ClientListResponseSchema,
  ClientStopResponseSchema,
} from "#protocol/client.ts";
import {
  BoxSchema,
  InfoResponseSchema,
  WePasteResponseSchema,
  CommandResponseSchema,
} from "#protocol/bridge.ts";
import {
  SiteSchema,
  required,
  doctor,
  findSite,
  type CaptureOptions,
} from "./site.ts";
import { exportMedia } from "./export.ts";
import {
  SandboxListResponseSchema,
  SnapshotBytesResponseSchema,
} from "#protocol/ipc.ts";
import { CaptureTransport } from "./transport.ts";
import { runScene } from "./runner.ts";
import { initializeRun, RunSchema, type CaptureRun } from "./model.ts";
import { renderMedia, sha256 } from "./media.ts";
import { reviewScene } from "./review-command.ts";
import type { CaptureScene } from "./define.ts";

const captures = path.join(MC_DIR, "captures");
const SceneSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]+$/u),
  description: z.string(),
  staging: z.tuple([z.number(), z.number(), z.number()]),
  bounds: z.object({
    min: z.tuple([z.number(), z.number(), z.number()]),
    max: z.tuple([z.number(), z.number(), z.number()]),
  }),
  inspectors: z.array(z.string()),
  setup: z.custom<CaptureScene["setup"]>(
    (value) => typeof value === "function",
  ),
  run: z.custom<CaptureScene["run"]>((value) => typeof value === "function"),
});

function runDirectory(id: string): string {
  if (!/^capture-[a-f0-9-]{36}$/u.test(id))
    throw new Error("Invalid capture run ID");
  return path.join(captures, id);
}

async function readRun(id: string) {
  return RunSchema.parse(
    await Bun.file(path.join(runDirectory(id), "run.json")).json(),
  );
}

async function loadScene(file: string): Promise<CaptureScene> {
  const imported: unknown = await import(
    pathToFileURL(path.resolve(file)).href
  );
  return z.object({ default: SceneSchema }).parse(imported).default;
}

function print(value: unknown): void {
  process.stdout.write(
    `${typeof value === "string" ? value : JSON.stringify(value)}\n`,
  );
}

async function startScene(
  argument: string | undefined,
  options: CaptureOptions,
): Promise<void> {
  const target = required(options.target, "--target");
  const sceneFile = path.resolve(required(argument, "scene.ts"));
  const scene = await loadScene(sceneFile);
  const site = SiteSchema.parse(
    await Bun.file(required(options.site, "--site")).json(),
  );
  if (site.target !== target)
    throw new Error(
      "Site target differs; rehearse on a copied site explicitly",
    );
  const [x, y, zz] = site.anchor;
  const box = BoxSchema.parse({
    world: site.world,
    min: {
      x: x + scene.bounds.min[0],
      y: y + scene.bounds.min[1],
      z: zz + scene.bounds.min[2],
    },
    max: {
      x: x + scene.bounds.max[0],
      y: y + scene.bounds.max[1],
      z: zz + scene.bounds.max[2],
    },
  });
  const id = `capture-${randomUUID()}`;
  await mkdir(captures, { recursive: true, mode: 0o700 });
  const directory = runDirectory(id);
  const run = RunSchema.parse({
    schema: 1,
    id,
    target,
    name: options.account ?? site.name,
    reason: required(options.reason, "--reason"),
    scene: sceneFile,
    sceneHash: await sha256(sceneFile),
    box,
    anchor: site.anchor,
    state: "preflight",
    checkpoint: null,
    inspectors: scene.inspectors,
    baseline: null,
    server: null,
    snapshot: null,
    inspection: null,
    origin: null,
    staging: null,
    cleanup: [],
    captures: [],
    error: "",
  });
  await initializeRun(directory, run);
  const stop = () => {
    void Bun.write(path.join(directory, "stop"), "stop");
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    print(JSON.stringify(await runScene(directory, scene, run), null, 2));
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
  if (run.state !== "complete") process.exitCode = 1;
  return;
}

async function recoverScene(
  run: CaptureRun,
  directory: string,
  options: CaptureOptions,
): Promise<void> {
  if (["complete", "failed"].includes(run.state))
    throw new Error("Run does not need recovery");
  if (options.target !== run.target)
    throw new Error("Recovery needs the explicit original --target");
  run.reason = required(options.reason, "--reason");
  const recovery: CaptureScene = {
    name: "recovery",
    description: "Replay saved compensation only",
    bounds: { min: [0, 0, 0], max: [0, 0, 0] },
    staging: [0, 0, 0],
    inspectors: run.inspectors,
    setup: () => Promise.resolve(),
    run: () => Promise.resolve(),
  };
  print(
    JSON.stringify(await runScene(directory, recovery, run, true), null, 2),
  );
  return;
}

async function renderScene(run: CaptureRun, directory: string): Promise<void> {
  const output = path.join(directory, `render-${randomUUID()}`);
  await mkdir(output);
  for (const capture of run.captures) {
    if ((await sha256(capture.source)) !== capture.sourceHash)
      throw new Error("Capture original changed");
    await renderMedia(
      capture.source,
      capture.presentation,
      path.join(output, capture.name),
    );
  }
  await Bun.write(
    path.join(directory, "render.json"),
    JSON.stringify({ directory: output }),
  );
  print(output);
  return;
}

async function exportScene(
  run: CaptureRun,
  rendered: { directory: string },
  options: CaptureOptions,
): Promise<void> {
  if (options.docs !== "ts-mc-docs")
    throw new Error("Export requires --docs ts-mc-docs");
  const root = path.resolve(import.meta.dirname, "../../../..");
  const snippets = await exportMedia(
    run,
    rendered.directory,
    path.join(root, "packages/ts-mc-docs/public"),
  );
  for (const snippet of snippets) print(snippet);
}

async function rehearseScene(
  argument: string | undefined,
  options: CaptureOptions,
): Promise<void> {
  const target = required(
    options.target,
    "--target <production-profile sandbox>",
  );
  if (target === "live")
    throw new Error("Rehearsals require a disposable sandbox");
  const reason = required(options.reason, "--reason");
  const source = SiteSchema.parse(
    await Bun.file(required(options.site, "--site")).json(),
  );
  const transport = new CaptureTransport(target, reason);
  const { sandboxes } = await transport.request(
    SandboxListResponseSchema,
    "GET",
    "/sandboxes",
  );
  const sandbox = sandboxes.find((candidate) => candidate.id === target);
  if (
    sandbox === undefined ||
    !["storm-prod", "storm-candidate"].includes(sandbox.profile)
  )
    throw new Error("Rehearsal requires a production-profile sandbox");
  const { clients } = await transport.request(
    ClientListResponseSchema,
    "GET",
    "/clients",
  );
  if (clients.some((client) => client.target === target))
    throw new Error("Rehearsal needs a sandbox without other clients");
  const original = new CaptureTransport(source.target, reason);
  const schematic = await original.world(
    SnapshotBytesResponseSchema,
    `snapshots/${source.snapshot}`,
  );
  const info = await transport.world(InfoResponseSchema, "info");
  const world = info.worlds.find(
    (candidate) => candidate.name === source.world,
  );
  if (world === undefined)
    throw new Error("Sandbox does not contain the captured site's world");
  await transport.world(WePasteResponseSchema, "paste", {
    session: "capture-rehearsal",
    world: source.world,
    schematic: schematic.base64,
    at: source.box.min,
    rotate: 0,
    ignoreAir: false,
  });
  const name = "CapturePreview";
  await transport.request(ClientStatusResponseSchema, "POST", "/clients", {
    target,
    name,
    op: true,
    gameMode: "CREATIVE",
  });
  try {
    await transport.world(CommandResponseSchema, "command", {
      command: `execute in ${world.key} run minecraft:tp ${name} ${source.anchor.map((value) => value.toString()).join(" ")}`,
    });
    const directory = path.join(captures, `rehearsal-${randomUUID()}`);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const siteFile = path.join(directory, "site.json");
    await Bun.write(siteFile, JSON.stringify({ ...source, target, name }));
    await startScene(argument, {
      ...options,
      target,
      account: name,
      site: siteFile,
    });
  } finally {
    await transport.request(
      ClientStopResponseSchema,
      "DELETE",
      `/clients/${name}`,
    );
  }
}

async function main(): Promise<void> {
  const parsed = parseArgs({
    args: Bun.argv.slice(2),
    allowPositionals: true,
    strict: true,
    options: {
      target: { type: "string" },
      account: { type: "string" },
      reason: { type: "string" },
      site: { type: "string" },
      docs: { type: "string" },
      help: { type: "boolean" },
    },
  });
  const [action, argument] = parsed.positionals;
  const options = parsed.values;
  if (action === undefined || options.help === true) {
    print(
      "toolkit mc capture doctor --target <sandbox|live>\nsite find|select --target <sandbox|live> --account XiguaJerred --reason <why>\nrun <scene.ts> --site <site.json> --target <sandbox|live> --reason <why>\nstatus|stop|recover|render|review|export <run-id> [--target live --reason <why>] [--docs ts-mc-docs]",
    );
    return;
  }
  if (action === "doctor") return doctor(options);
  if (action === "site") return findSite(argument, options);
  if (action === "run") return startScene(argument, options);
  if (action === "rehearse") return rehearseScene(argument, options);
  const id = required(argument, "run-id");
  const directory = runDirectory(id);
  const run = await readRun(id);
  if (action === "status") {
    print(JSON.stringify(run, null, 2));
    return;
  }
  if (action === "stop") {
    await Bun.write(path.join(directory, "stop"), "stop");
    return;
  }
  if (action === "recover") return recoverScene(run, directory, options);
  if (action === "render") return renderScene(run, directory);
  const rendered = z
    .strictObject({ directory: z.string() })
    .parse(await Bun.file(path.join(directory, "render.json")).json());
  if (action === "export") return exportScene(run, rendered, options);
  if (action === "review") return reviewScene(rendered.directory);
  throw new Error(`Unknown capture action ${action}`);
}

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
