/**
 * `toolkit mc build …` runs this from the monorepo checkout (it needs the
 * renderer, registry and compile child, which never ship in the toolkit
 * binary). Server work goes through the mc daemon's unix socket.
 */
import { parseArgs } from "node:util";
import type { LintReport } from "@shepherdjerred/mc-build/lint/lint.ts";
import { z } from "zod";
import { PALETTE_NAMES } from "@shepherdjerred/mc-build/import/palette.ts";
import {
  BoxSchema,
  RotationSchema,
  SessionNameSchema,
} from "#protocol/bridge.ts";
import { parseTtl } from "@shepherdjerred/unix-socket-daemon";
import { normalizeArgv, wantsHelp } from "#protocol/argv.ts";
import { parseBlockPos } from "#protocol/ipc.ts";
import {
  buildStatus,
  promoteBuild,
  replayBuild,
  undoApply,
  verifyApply,
} from "./apply.ts";
import {
  captureSite,
  compileBuild,
  createCanvas,
  initBuild,
  lintBuild,
  renderBuild,
  runBuild,
} from "./commands.ts";
import type { Env } from "./helpers.ts";
import { appendLog } from "./build-log.ts";
import {
  CANDIDATE_HANDLERS,
  CANDIDATE_USAGE,
} from "./studio/candidate-commands.ts";
import { JUDGE_HANDLERS, JUDGE_USAGE } from "./studio/judge-commands.ts";
import { LOG_HANDLERS, LOG_USAGE } from "./log-commands.ts";
import { parseLook, parseSource } from "./look-args.ts";
import { importBuild } from "./import-build.ts";
import { componentCommand, libraryCommand } from "./catalog-cli.ts";
import { DaemonClient } from "./daemon-client.ts";
import { Journal } from "./journal.ts";

function buildName(raw: string): string {
  const parsed = SessionNameSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `--name must be 1-32 lowercase letters, digits or hyphens (got "${raw}")`,
    );
  }
  return parsed.data;
}

export const BUILD_USAGE = `
toolkit mc build — WorldEdit-first build workflow (op log + canvas + promote)

  init <dir> --name <n> --world <w> --anchor x,y,z [--seed 1]
  capture <dir> --target <id> --world <w> <x1,y1,z1> <x2,y2,z2>   Snapshot the site (+ render)
  canvas <dir> [--ttl 2h]               Void sandbox seeded with the site (becomes the default target)
  compile <dir>                         build.ts → schematic + paste op (replaces earlier program ops)
  import <dir> <file> [--at x,y,z] [--rotate 0|90|180|270]
                                        .litematic/.schem → schematic + paste op (+ preview render)
  import <dir> <model.obj> --height <n> [--solid] [--palette default|wool|concrete|terracotta]
                                        OBJ mesh (MTL colors/textures) → voxels → nearest blocks
  run <dir> [--target id]               Reset canvas to the site, replay all ops, record expected
  render <dir> [x1,y1,z1 x2,y2,z2] [--target id | --source canvas|expected|compiled] [--name n]
         [--mode value|normal|squint|relief|light] [--views sheet,elevations,hero,pov,survey]
         [--grid n] [--floor y] [--section z] [--crop front-door|centre|nw|ne|sw|se] [--compare <name>]
         (floor and section are build-local, anchor-relative, as in build.ts)
  lint <dir> [--target id | --source canvas|expected|compiled]
  replay <dir> [--target id] [--keep]   Fresh seeded sandbox: replay ops and diff against expected
  promote <dir> --target <id> [--confirm <planHash>]   Dry run, then snapshot + apply + verify
  verify <applyId>
  undo <applyId>                        Restore the pre-apply snapshot (last-in-first-out)
  status <dir>
${LOG_USAGE}
${JUDGE_USAGE}
${CANDIDATE_USAGE}
  library ls|search [--tag t]… [--text s] | show <slug> | use <slug> <dir> [--force]
                                        Curated programs to start from (mc-build library/)
  component ls|search [--tag t]… [--text s] | show <name> | render <name>
                                        Shared helpers build.ts can import (mc-build components/)
  component propose <dir> <file> --name n --description d [--tag t]…
                                        Copy a build-local helper into components/ for review
  judge <a> <b> [--rubric micro|map] [--model id]   Pairwise vision judge of two renders (PNG or build dir), order-swapped
  judge --absolute <a> [--rubric micro|map] [--model id]   Score one render 0–5 per rubric axis, aesthetics asked last

Live tsmc: promote/undo with --target live also need --reason "<why>" (journaled), and
--allow-players when a human is near the box, and --allow-protected inside a protected
region (e.g. the zombies settlement). See toolkit mc live --help.

Record manual edits with: toolkit mc we|paste|cmd … --record <dir>
All commands accept --json. Exit code 2 = lint errors, replay mismatch, or failed verification.
`;

const OPTIONS = {
  json: { type: "boolean", default: false },
  target: { type: "string" },
  name: { type: "string" },
  world: { type: "string" },
  anchor: { type: "string" },
  seed: { type: "string" },
  ttl: { type: "string" },
  confirm: { type: "string" },
  expected: { type: "boolean", default: false },
  keep: { type: "boolean", default: false },
  reason: { type: "string" },
  "allow-players": { type: "boolean", default: false },
  "allow-protected": { type: "boolean", default: false },
  "confirm-dangerous": { type: "boolean", default: false },
  model: { type: "string" },
  rubric: { type: "string" },
  absolute: { type: "boolean", default: false },
  render: { type: "string" },
  stage: { type: "string" },
  scores: { type: "string" },
  note: { type: "string", multiple: true },
  among: { type: "string" },
  size: { type: "string" },
  tail: { type: "string" },
  source: { type: "string" },
  mode: { type: "string" },
  views: { type: "string" },
  grid: { type: "string" },
  compare: { type: "string" },
  floor: { type: "string" },
  section: { type: "string" },
  crop: { type: "string" },
  tag: { type: "string", multiple: true },
  text: { type: "string" },
  description: { type: "string" },
  force: { type: "boolean", default: false },
  at: { type: "string" },
  rotate: { type: "string" },
  height: { type: "string" },
  solid: { type: "boolean", default: false },
  palette: { type: "string" },
} as const;

/** Usage label for the first positional when it is not a build directory. */
const FIRST_POSITIONAL: Record<string, string> = {
  verify: "<applyId>",
  undo: "<applyId>",
  judge: "<a>",
  library: "<ls|search|show|use>",
  component: "<ls|search|show|render|propose>",
};
const PaletteNameSchema = z.enum(PALETTE_NAMES);
type Values = ReturnType<
  typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>
>["values"];

function required(value: string | undefined, name: string): string {
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required\n${BUILD_USAGE}`);
  }
  return value;
}

function print(json: boolean, value: unknown, human: string): void {
  process.stdout.write(`${json ? JSON.stringify(value, null, 2) : human}\n`);
}

function lintSummary(report: LintReport): string {
  const lines = report.findings.map(
    (finding) =>
      `  ${finding.severity.toUpperCase().padEnd(5)} ${finding.code}: ${finding.message}${
        finding.at.length > 0
          ? ` @ ${finding.at.map((p) => `${p.x.toString()},${p.y.toString()},${p.z.toString()}`).join(" ")}`
          : ""
      }\n        ${finding.hint}`,
  );
  return [
    `lint: ${report.errors.toString()} error(s), ${report.warnings.toString()} warning(s); ${report.stats.blocks.toString()} blocks`,
    ...lines,
  ].join("\n");
}

type Handler = (
  env: Env,
  dir: string,
  values: Values,
  rest: string[],
) => Promise<number>;

const HANDLERS: Record<string, Handler> = {
  ...LOG_HANDLERS,
  ...JUDGE_HANDLERS,
  ...CANDIDATE_HANDLERS,
  init: async (_env, dir, values) => {
    const result = await initBuild(dir, {
      name: buildName(required(values.name, "--name")),
      world: required(values.world, "--world"),
      anchor: parseBlockPos(required(values.anchor, "--anchor")),
      seed: Number(values.seed ?? "1"),
    });
    print(
      values.json,
      result,
      `initialized ${result.dir} (${result.created.join(", ")})`,
    );
    return 0;
  },
  capture: async (env, dir, values, rest) => {
    const [a, b] = rest;
    const box = BoxSchema.parse({
      world: required(values.world, "--world"),
      min: parseBlockPos(required(a, "<x1,y1,z1>")),
      max: parseBlockPos(required(b, "<x2,y2,z2>")),
    });
    const result = await captureSite(env, dir, {
      target: required(values.target, "--target"),
      box,
    });
    print(
      values.json,
      result,
      `captured site ${result.size.x.toString()}×${result.size.y.toString()}×${result.size.z.toString()} (siteHash ${result.siteHash.slice(0, 12)})\n  surface: ${result.surface.join(", ")}\n  render: ${result.render}`,
    );
    return 0;
  },
  canvas: async (env, dir, values) => {
    const result = await createCanvas(
      env,
      dir,
      values.ttl === undefined ? {} : { ttlSeconds: parseTtl(values.ttl) },
    );
    print(
      values.json,
      result,
      `canvas ${result.canvas} ready (site pasted); it is now the build's default target`,
    );
    return 0;
  },
  compile: async (_env, dir, values) => {
    const result = await compileBuild(dir);
    print(
      values.json,
      result,
      [
        `compiled ${result.blocks.toString()} blocks → ${result.schematic} (paste at ${result.at.x.toString()},${result.at.y.toString()},${result.at.z.toString()}; ${result.clears.toString()} clear box(es))`,
        ...result.logs.map((line) => `  log: ${line}`),
        lintSummary(result.lint),
      ].join("\n"),
    );
    return result.lint.ok ? 0 : 2;
  },
  import: async (_env, dir, values, rest) => {
    const [file] = rest;
    const result = await importBuild(dir, required(file, "<file>"), {
      ...(values.at === undefined ? {} : { at: parseBlockPos(values.at) }),
      rotate: RotationSchema.parse(Number(values.rotate ?? "0")),
      ...(values.height === undefined ? {} : { height: Number(values.height) }),
      solid: values.solid,
      palette: PaletteNameSchema.parse(values.palette ?? "default"),
    });
    print(
      values.json,
      result,
      [
        `imported ${result.description}`,
        `  ${result.blocks.toString()} blocks, ${result.size.x.toString()}×${result.size.y.toString()}×${result.size.z.toString()} → ${result.schematic} (paste at ${result.at.x.toString()},${result.at.y.toString()},${result.at.z.toString()})`,
        `  render: ${result.render}`,
        lintSummary(result.lint),
      ].join("\n"),
    );
    return result.lint.ok ? 0 : 2;
  },
  run: async (env, dir, values) => {
    const result = await runBuild(
      env,
      dir,
      values.target === undefined ? {} : { target: values.target },
    );
    print(
      values.json,
      result,
      `replayed ${result.ops.toString()} op(s) on ${result.target}; expected.json updated`,
    );
    return 0;
  },
  render: async (env, dir, values, rest) => {
    const [a, b] = rest;
    const result = await renderBuild(env, dir, {
      ...(values.target === undefined ? {} : { target: values.target }),
      ...(values.name === undefined ? {} : { name: values.name }),
      ...(a === undefined
        ? {}
        : {
            region: {
              min: parseBlockPos(a),
              max: parseBlockPos(required(b, "<x2,y2,z2>")),
            },
          }),
      ...(values.compare === undefined ? {} : { compare: values.compare }),
      source: parseSource(values),
      look: parseLook(values),
    });
    const lines = Object.entries(result.files).map(
      ([view, file]) => `  ${view.padEnd(14)} ${file}`,
    );
    print(
      values.json,
      result,
      [
        `render: ${result.render}`,
        ...lines.filter((line) => !line.includes(result.render)),
        ...result.skipped.map((line) => `  not in this picture: ${line}`),
      ].join("\n"),
    );
    return 0;
  },
  lint: async (env, dir, values) => {
    const report = await lintBuild(env, dir, {
      ...(values.target === undefined ? {} : { target: values.target }),
      source: parseSource(values),
    });
    print(
      values.json,
      report,
      [
        lintSummary(report),
        ...report.skipped.map((line) => `  not linted: ${line}`),
      ].join("\n"),
    );
    return report.ok ? 0 : 2;
  },
  replay: async (env, dir, values) => {
    const result = await replayBuild(env, dir, {
      ...(values.target === undefined ? {} : { target: values.target }),
      keep: values.keep,
    });
    print(
      values.json,
      result,
      result.mismatches === 0
        ? `replay on ${result.target}: ${result.ops.toString()} op(s), matches expected exactly`
        : `replay on ${result.target}: ${result.mismatches.toString()} mismatch(es) — the op log is not deterministic (random % patterns or order-dependent ops). Promote still applies the frozen canvas result exactly.\n${result.samples.map((s) => `  ${s.at.x.toString()},${s.at.y.toString()},${s.at.z.toString()} expected ${s.expected} got ${s.actual}`).join("\n")}`,
    );
    return result.mismatches === 0 ? 0 : 2;
  },
  promote: async (env, dir, values) => {
    const result = await promoteBuild(env, dir, {
      target: required(values.target, "--target"),
      ...(values.confirm === undefined ? {} : { confirm: values.confirm }),
    });
    if (result.applied === null) {
      print(
        values.json,
        result,
        `plan for ${result.target}: ${result.ops.toString()} op(s), ${result.changes.toString()} block(s) will change\n  planHash ${result.planHash}\n  apply with: toolkit mc build promote ${dir} --target ${result.target} --confirm ${result.planHash}`,
      );
      return 0;
    }
    await appendLog(dir, {
      kind: "promote",
      target: result.target,
      applyId: result.applied.applyId,
    });
    print(
      values.json,
      result,
      `applied ${result.applied.applyId} to ${result.target}: ${result.applied.status} (${String(result.diff?.mismatches ?? 0)} mismatch(es)); undo with toolkit mc build undo ${result.applied.applyId}`,
    );
    return result.applied.status === "verified" ? 0 : 2;
  },
  verify: async (env, applyId, values) => {
    const result = await verifyApply(env, applyId);
    print(
      values.json,
      result,
      `${applyId}: ${result.entry.status} (${result.mismatches.toString()} mismatch(es))`,
    );
    return result.mismatches === 0 ? 0 : 2;
  },
  undo: async (env, applyId, values) => {
    const result = await undoApply(env, applyId);
    print(
      values.json,
      result,
      `${applyId}: undone; target ${result.restoredToSite ? "matches the captured site again" : "restored from snapshot (differs from the captured site — it changed before the apply)"}`,
    );
    return 0;
  },
  library: async (_env, sub, values, rest) =>
    libraryCommand({ print, required, usage: BUILD_USAGE }, sub, values, rest),
  component: async (_env, sub, values, rest) =>
    componentCommand(
      { print, required, usage: BUILD_USAGE },
      sub,
      values,
      rest,
    ),
  status: async (env, dir, values) => {
    const result = await buildStatus(env, dir);
    const site = result.manifest.site;
    print(
      values.json,
      result,
      [
        `${result.manifest.name}: world ${result.manifest.world}, anchor ${result.manifest.anchor.x.toString()},${result.manifest.anchor.y.toString()},${result.manifest.anchor.z.toString()}`,
        `  site: ${site === undefined ? "not captured" : `${site.min.x.toString()},${site.min.y.toString()},${site.min.z.toString()} → ${site.max.x.toString()},${site.max.y.toString()},${site.max.z.toString()}`}`,
        `  canvas: ${result.manifest.canvas ?? "none"}`,
        `  ops: ${result.ops.manual.toString()} manual, ${result.ops.program.toString()} from build.ts`,
        ...result.applies.map(
          (entry) => `  ${entry.applyId} → ${entry.target}: ${entry.status}`,
        ),
      ].join("\n"),
    );
    return 0;
  },
};

async function main(): Promise<number> {
  const [action, ...args] = Bun.argv.slice(2);
  if (
    action === undefined ||
    action === "help" ||
    action === "--help" ||
    action === "-h" ||
    wantsHelp(args)
  ) {
    process.stdout.write(BUILD_USAGE);
    return 0;
  }
  const handler = HANDLERS[action];
  if (handler === undefined) {
    throw new Error(`unknown build action "${action}"\n${BUILD_USAGE}`);
  }
  const { values, positionals } = parseArgs({
    args: normalizeArgv(args, OPTIONS),
    options: OPTIONS,
    allowPositionals: true,
    strict: true,
  });
  const [dir, ...rest] = positionals;
  const env: Env = {
    // Only live writes read these; sandbox targets ignore them.
    client: new DaemonClient(undefined, {
      reason: values.reason,
      allowPlayers: values["allow-players"],
      allowProtected: values["allow-protected"],
      confirmDangerous: values["confirm-dangerous"],
    }),
    journal: new Journal(),
    log: (message) => {
      console.error(message);
    },
  };
  return handler(
    env,
    required(dir, FIRST_POSITIONAL[action] ?? "<dir>"),
    values,
    rest,
  );
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(
    error instanceof z.ZodError
      ? z.prettifyError(error)
      : error instanceof Error
        ? error.message
        : String(error),
  );
  process.exitCode = 1;
}
