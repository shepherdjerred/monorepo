/**
 * `toolkit mc build …` runs this from the monorepo checkout (it needs the
 * renderer, registry and compile child, which never ship in the toolkit
 * binary). Server work goes through the mc daemon's unix socket.
 */
import { parseArgs } from "node:util";
import type { LintReport } from "@shepherdjerred/mc-build/lint/lint.ts";
import { BoxSchema, SessionNameSchema } from "#protocol/bridge.ts";
import { parseBlockPos, parseTtl } from "#protocol/ipc.ts";
import {
  buildStatus,
  captureSite,
  compileBuild,
  createCanvas,
  initBuild,
  lintBuild,
  promoteBuild,
  renderBuild,
  replayBuild,
  runBuild,
  undoApply,
  verifyApply,
  type Env,
} from "./commands.ts";
import { DaemonClient } from "./daemon-client.ts";
import { Journal } from "./journal.ts";

export const BUILD_USAGE = `
toolkit mc build — WorldEdit-first build workflow (op log + canvas + promote)

  init <dir> --name <n> --world <w> --anchor x,y,z [--seed 1]
  capture <dir> --target <id> --world <w> <x1,y1,z1> <x2,y2,z2>   Snapshot the site (+ render)
  canvas <dir> [--ttl 2h]               Void sandbox seeded with the site (becomes the default target)
  compile <dir>                         build.ts → schematic + paste op (replaces earlier program ops)
  run <dir> [--target id]               Reset canvas to the site, replay all ops, record expected
  render <dir> [--target id | --expected] [--name n]
  lint <dir> [--target id | --expected]
  replay <dir> [--target id] [--keep]   Fresh seeded sandbox: replay ops and diff against expected
  promote <dir> --target <id> [--confirm <planHash>]   Dry run, then snapshot + apply + verify
  verify <applyId>
  undo <applyId>                        Restore the pre-apply snapshot (last-in-first-out)
  status <dir>

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
} as const;

type Values = ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>["values"];

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
        finding.at.length > 0 ? ` @ ${finding.at.map((p) => `${p.x.toString()},${p.y.toString()},${p.z.toString()}`).join(" ")}` : ""
      }\n        ${finding.hint}`,
  );
  return [
    `lint: ${report.errors.toString()} error(s), ${report.warnings.toString()} warning(s); ${report.stats.blocks.toString()} blocks`,
    ...lines,
  ].join("\n");
}

type Handler = (env: Env, dir: string, values: Values, rest: string[]) => Promise<number>;

const HANDLERS: Record<string, Handler> = {
  init: async (_env, dir, values) => {
    const result = await initBuild(dir, {
      name: SessionNameSchema.parse(required(values.name, "--name")),
      world: required(values.world, "--world"),
      anchor: parseBlockPos(required(values.anchor, "--anchor")),
      seed: Number(values.seed ?? "1"),
    });
    print(values.json, result, `initialized ${result.dir} (${result.created.join(", ")})`);
    return 0;
  },
  capture: async (env, dir, values, rest) => {
    const [a, b] = rest;
    const box = BoxSchema.parse({
      world: required(values.world, "--world"),
      min: parseBlockPos(required(a, "<x1,y1,z1>")),
      max: parseBlockPos(required(b, "<x2,y2,z2>")),
    });
    const result = await captureSite(env, dir, { target: required(values.target, "--target"), box });
    print(
      values.json,
      result,
      `captured site ${result.size.x.toString()}×${result.size.y.toString()}×${result.size.z.toString()} (siteHash ${result.siteHash.slice(0, 12)})\n  surface: ${result.surface.join(", ")}\n  render: ${result.render}`,
    );
    return 0;
  },
  canvas: async (env, dir, values) => {
    const result = await createCanvas(env, dir, values.ttl === undefined ? {} : { ttlSeconds: parseTtl(values.ttl) });
    print(values.json, result, `canvas ${result.canvas} ready (site pasted); it is now the build's default target`);
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
  run: async (env, dir, values) => {
    const result = await runBuild(env, dir, values.target === undefined ? {} : { target: values.target });
    print(values.json, result, `replayed ${result.ops.toString()} op(s) on ${result.target}; expected.json updated`);
    return 0;
  },
  render: async (env, dir, values) => {
    const result = await renderBuild(env, dir, {
      ...(values.target === undefined ? {} : { target: values.target }),
      ...(values.name === undefined ? {} : { name: values.name }),
      expected: values.expected,
    });
    print(values.json, result, `render: ${result.render}`);
    return 0;
  },
  lint: async (env, dir, values) => {
    const report = await lintBuild(env, dir, {
      ...(values.target === undefined ? {} : { target: values.target }),
      expected: values.expected,
    });
    print(values.json, report, lintSummary(report));
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
    print(
      values.json,
      result,
      `applied ${result.applied.applyId} to ${result.target}: ${result.applied.status} (${String(result.diff?.mismatches ?? 0)} mismatch(es)); undo with toolkit mc build undo ${result.applied.applyId}`,
    );
    return result.applied.status === "verified" ? 0 : 2;
  },
  verify: async (env, applyId, values) => {
    const result = await verifyApply(env, applyId);
    print(values.json, result, `${applyId}: ${result.entry.status} (${result.mismatches.toString()} mismatch(es))`);
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
        ...result.applies.map((entry) => `  ${entry.applyId} → ${entry.target}: ${entry.status}`),
      ].join("\n"),
    );
    return 0;
  },
};

async function main(): Promise<number> {
  const [action, ...args] = Bun.argv.slice(2);
  if (action === undefined || action === "help" || action === "--help") {
    process.stdout.write(BUILD_USAGE);
    return 0;
  }
  const handler = HANDLERS[action];
  if (handler === undefined) {
    throw new Error(`unknown build action "${action}"\n${BUILD_USAGE}`);
  }
  const { values, positionals } = parseArgs({ args, options: OPTIONS, allowPositionals: true, strict: true });
  const [dir, ...rest] = positionals;
  const env: Env = {
    client: new DaemonClient(),
    journal: new Journal(),
    log: (message) => {
      console.error(message);
    },
  };
  return handler(env, required(dir, action === "verify" || action === "undo" ? "<applyId>" : "<dir>"), values, rest);
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
