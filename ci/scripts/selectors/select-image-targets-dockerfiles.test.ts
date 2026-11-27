import { expect, test } from "vitest";
import nodePath from "node:path";

import { selectImageTargetsWithReasons } from "./select-image-targets.ts";
import { GLOBAL_IMAGE_INPUTS } from "./select-image-targets-inputs.ts";
import {
  MANIFESTS_STAGE_SOURCES,
  manifestsStageCopies,
} from "./select-image-targets-manifests.ts";
import {
  PARTIAL_WORKSPACE_SOURCE_INPUTS,
  pathMatchesPrefix,
} from "./select-image-targets-workspaces.ts";
import {
  APPLICATION_IMAGE_TARGETS,
  INFRASTRUCTURE_IMAGE_TARGETS,
} from "../images/image-targets.ts";

// Under-selection guard: a changed file an image's Dockerfile copies must
// select that image, or the image ships stale. This walks every bake target's
// Dockerfile from its built stage, expands each build-context COPY/ADD/bind
// source to the tracked files it covers, and asks the real selector.

const REPO_ROOT = new URL("../../..", import.meta.url).pathname;

// Content-aware inputs have their own attribution and tests: root manifests by
// changed keys, bun.lock by closure fingerprints, patches by patched package.
const CONTENT_AWARE_INPUTS = [
  "package.json",
  "scripts/package.json",
  "bun.lock",
  "patches/",
];

// Build-context files a build stage copies that provably never reach the
// image. glitter-boys-launcher's builder copies its whole package but compiles
// only the glitter-boys-service crate graph: launcher-core compiles in
// catalog.json, prerequisites.json and release-profile.json, and assets/
// belong to the desktop app.
const BUILD_ONLY_CONTEXT_FILES: Readonly<Record<string, readonly string[]>> = {
  infra: [
    "packages/glitter-boys-launcher/.gitignore",
    "packages/glitter-boys-launcher/README.md",
    "packages/glitter-boys-launcher/assets/**",
    "packages/glitter-boys-launcher/package.json",
    "packages/glitter-boys-launcher/publication.env",
    "packages/glitter-boys-launcher/published-release.json",
    "packages/glitter-boys-launcher/scripts/**",
    "packages/glitter-boys-launcher/turbo.json",
  ],
};

// The manifests stage reads every workspace manifest but emits only the
// install closure's (application-image-reproducibility.test.ts).
const PROJECTION =
  "bun /tools/ci/scripts/images/workspace-manifests.ts /workspace /closure";

const SELECTOR_TARGETS = new Map<string, string>([
  ...APPLICATION_IMAGE_TARGETS.map((target) => [target, target] as const),
  ...INFRASTRUCTURE_IMAGE_TARGETS.map((target) => [target, "infra"] as const),
]);

type BakeTarget = {
  readonly name: string;
  readonly context: string;
  readonly dockerfile: string;
  readonly stage: string | undefined;
  readonly contexts: ReadonlyMap<string, string>;
};

function hclField(body: string, key: string): string | undefined {
  return new RegExp(String.raw`^\s*${key}\s*=\s*"([^"]*)"`, "m").exec(
    body,
  )?.[1];
}

function bakeTargets(hcl: string): Map<string, BakeTarget> {
  const bodies = new Map<string, string>();
  for (const [, name = "", body = ""] of hcl.matchAll(
    /^target "([^"]+)" \{\n([\s\S]*?)^\}/gm,
  )) {
    bodies.set(name, body);
  }
  const targets = new Map<string, BakeTarget>();
  for (const [name, body] of bodies) {
    const parent = /inherits\s*=\s*\["([^"]+)"\]/.exec(body)?.[1];
    const inherited = parent === undefined ? "" : (bodies.get(parent) ?? "");
    const context =
      hclField(body, "context") ?? hclField(inherited, "context") ?? ".";
    const block = /contexts\s*=\s*\{([\s\S]*?)\}/.exec(body)?.[1] ?? "";
    targets.set(name, {
      name,
      context,
      dockerfile: nodePath.join(
        context,
        hclField(body, "dockerfile") ?? "Dockerfile",
      ),
      stage: hclField(body, "target") ?? hclField(inherited, "target"),
      contexts: new Map(
        [...block.matchAll(/^\s*([\w-]+)\s*=\s*"([^"]+)"/gm)].map(
          ([, key = "", value = ""]) => [key, value],
        ),
      ),
    });
  }
  return targets;
}

type Instruction = { readonly keyword: string; readonly args: string[] };
type Stage = {
  readonly name: string;
  readonly base: string;
  readonly instructions: Instruction[];
};

/** Expand global ARG defaults in a FROM image; an unresolved one throws. */
function fromBase(
  image: string,
  globalArgs: ReadonlyMap<string, string>,
): string {
  const base = image.replaceAll(
    /\$\{(\w+)\}|\$(\w+)/g,
    (reference, braced?: string, bare?: string) =>
      globalArgs.get(braced ?? bare ?? "") ?? reference,
  );
  if (base.includes("$")) throw new Error(`unresolved FROM ${image}`);
  return base;
}

function dockerStages(dockerfile: string): Stage[] {
  const stages: Stage[] = [];
  const globalArgs = new Map<string, string>();
  for (const line of dockerfile.replaceAll("\\\n", " ").split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const [first = "", ...args] = trimmed.split(/\s+/);
    const keyword = first.toUpperCase();
    if (keyword === "FROM") {
      const positional = args.filter((arg) => !arg.startsWith("--"));
      stages.push({
        base: fromBase(positional[0] ?? "", globalArgs),
        name: positional[2] ?? String(stages.length),
        instructions: [],
      });
    } else if (keyword === "ARG" && stages.length === 0) {
      const [name = "", value] = (args[0] ?? "").split("=");
      if (value !== undefined) globalArgs.set(name, value.replaceAll('"', ""));
    } else {
      stages.at(-1)?.instructions.push({ keyword, args });
    }
  }
  return stages;
}

type ContextRead = {
  readonly from: string | undefined;
  readonly sources: string[];
};

function bindMount(arg: string): ContextRead | undefined {
  const options = new Map(
    arg
      .slice("--mount=".length)
      .split(",")
      .map((option) => {
        const [key = "", value = ""] = option.split("=");
        return [key, value] as const;
      }),
  );
  return (options.get("type") ?? "bind") === "bind"
    ? { from: options.get("from"), sources: [options.get("source") ?? "."] }
    : undefined;
}

function contextReads({ keyword, args }: Instruction): ContextRead[] {
  if (keyword === "RUN") {
    return args
      .filter((arg) => arg.startsWith("--mount="))
      .flatMap((arg) => bindMount(arg) ?? []);
  }
  if (keyword !== "COPY" && keyword !== "ADD") return [];
  if (args[0]?.startsWith("[") === true) {
    throw new Error(`JSON-form ${keyword} is unsupported: ${args.join(" ")}`);
  }
  const from = args
    .find((arg) => arg.startsWith("--from="))
    ?.slice("--from=".length);
  const positional = args.filter((arg) => !arg.startsWith("--"));
  return [{ from, sources: positional.slice(0, -1) }];
}

type CopiedSource = { readonly path: string; readonly lineage: boolean };

/** The image's own filesystem: the built stage and its FROM ancestors. */
function lineageOf(stages: ReadonlyMap<string, Stage>, built: string) {
  const lineage = new Set<string>();
  let stage = stages.get(built);
  while (stage !== undefined && !lineage.has(stage.name)) {
    lineage.add(stage.name);
    stage = stages.get(stage.base);
  }
  return lineage;
}

type StageWalk = {
  readonly target: BakeTarget;
  readonly stages: ReadonlyMap<string, Stage>;
  readonly pending: string[];
  readonly upstreams: BakeTarget[];
  readonly sources: CopiedSource[];
  readonly lineage: boolean;
};

function contextSources(
  walk: StageWalk,
  read: ContextRead,
  root: string,
): void {
  for (const source of read.sources) {
    if (/^https?:\/\//.test(source)) continue;
    if (source.includes("$")) {
      throw new Error(`${walk.target.dockerfile} copies unresolved ${source}`);
    }
    walk.sources.push({
      path: nodePath.join(root, source).replace(/\/$/, ""),
      lineage: walk.lineage,
    });
  }
}

/** Queue the stage, upstream target, or context files one read names. */
function followRead(
  walk: StageWalk,
  read: ContextRead,
  targets: ReadonlyMap<string, BakeTarget>,
  projects: boolean,
): void {
  if (read.from !== undefined && walk.stages.has(read.from)) {
    walk.pending.push(read.from);
    return;
  }
  const named =
    read.from === undefined ? undefined : walk.target.contexts.get(read.from);
  if (named === undefined && read.from !== undefined) return; // an image
  if (named?.startsWith("target:") === true) {
    const upstream = targets.get(named.slice("target:".length));
    if (upstream === undefined) throw new Error(`unknown context ${named}`);
    walk.upstreams.push(upstream);
    return;
  }
  if (!projects) contextSources(walk, read, named ?? walk.target.context);
}

/** Context sources the bake target's built stage reads, by repo path. */
async function copiedSources(
  target: BakeTarget,
  targets: ReadonlyMap<string, BakeTarget>,
  inLineage = true,
): Promise<CopiedSource[]> {
  const parsed = dockerStages(
    await Bun.file(nodePath.join(REPO_ROOT, target.dockerfile)).text(),
  );
  const stages = new Map(parsed.map((stage) => [stage.name, stage]));
  const built = target.stage ?? parsed.at(-1)?.name ?? "";
  const lineage = lineageOf(stages, built);
  const upstreams: BakeTarget[] = [];
  const sources: CopiedSource[] = [];
  const pending = [built];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const stage = stages.get(pending.pop() ?? "");
    if (stage === undefined || visited.has(stage.name)) continue;
    visited.add(stage.name);
    const walk: StageWalk = {
      target,
      stages,
      pending,
      upstreams,
      sources,
      lineage: inLineage && lineage.has(stage.name),
    };
    followRead(walk, { from: stage.base, sources: ["."] }, targets, false);
    const projects = stage.instructions.some((instruction) =>
      instruction.args.join(" ").startsWith(PROJECTION),
    );
    const reads = stage.instructions.flatMap((instruction) =>
      contextReads(instruction),
    );
    for (const read of reads) {
      followRead(walk, read, targets, projects);
    }
  }
  for (const upstream of upstreams) {
    sources.push(...(await copiedSources(upstream, targets, false)));
  }
  return sources;
}

function buildOnly(target: string, path: string): boolean {
  const partial = Object.keys(PARTIAL_WORKSPACE_SOURCE_INPUTS[target] ?? {});
  return (
    partial.some((dir) => path.startsWith(`${dir}/`)) ||
    (BUILD_ONLY_CONTEXT_FILES[target] ?? []).some((glob) =>
      pathMatchesPrefix(path, glob),
    )
  );
}

const ATTRIBUTED_ELSEWHERE = [...CONTENT_AWARE_INPUTS, ...GLOBAL_IMAGE_INPUTS];

function mustSelect(
  target: string,
  source: CopiedSource,
  path: string,
): boolean {
  const elsewhere = ATTRIBUTED_ELSEWHERE.some((input) =>
    pathMatchesPrefix(path, input),
  );
  return !elsewhere && (source.lineage || !buildOnly(target, path));
}

function trackedFiles(): string[] {
  return Bun.spawnSync(["git", "ls-files", "-z"], { cwd: REPO_ROOT })
    .stdout.toString()
    .split("\0")
    .filter((path) => path !== "");
}

function trackedUnder(tracked: readonly string[], source: string): string[] {
  if (/[*?[]/.test(source)) {
    const glob = new Bun.Glob(source);
    return tracked.filter((path) => glob.match(path));
  }
  return tracked.filter(
    (path) =>
      source === "." || path === source || path.startsWith(`${source}/`),
  );
}

/** Files each selector target's Dockerfiles copy that it must select for. */
async function requiredInputs(): Promise<{
  required: Map<string, Set<string>>;
  missingSources: string[];
}> {
  const tracked = trackedFiles();
  const bake = bakeTargets(
    await Bun.file(nodePath.join(REPO_ROOT, "docker-bake.hcl")).text(),
  );
  const required = new Map<string, Set<string>>();
  const missingSources: string[] = [];
  for (const target of bake.values()) {
    const selected = SELECTOR_TARGETS.get(target.name);
    if (selected === undefined) continue;
    const files = required.get(selected) ?? new Set<string>();
    required.set(selected, files);
    for (const source of await copiedSources(target, bake)) {
      const paths = trackedUnder(tracked, source.path);
      if (paths.length === 0) {
        missingSources.push(`${target.name}: ${source.path}`);
      }
      for (const path of paths.filter((candidate) =>
        mustSelect(selected, source, candidate),
      )) {
        files.add(path);
      }
    }
  }
  return { required, missingSources };
}

// One pass over every bake target and ~26k copied files; the selector call
// alone takes about a second, so this needs more than the 5 s default under
// parallel CI load.
const GUARD_TIMEOUT_MS = 30_000;

test(
  "every build-context file an image copies selects that image",
  async () => {
    const { required, missingSources } = await requiredInputs();
    expect(missingSources).toEqual([]);
    // The walk sees real copies: Delivery ships the service catalog, Birmel
    // never copies it, and Temporal's runtime copies scripts/lib.
    expect(
      required.get("delivery")?.has("packages/ops-model/services.json"),
    ).toBe(true);
    expect(
      required.get("birmel")?.has("packages/ops-model/services.json"),
    ).toBe(false);
    expect(required.get("temporal-worker")?.has("scripts/lib/run.ts")).toBe(
      true,
    );
    // Arcade's FROM ${ARG} stages resolve to its three named-context targets.
    const arcade = [...(required.get("arcade") ?? [])];
    for (const upstream of [
      "packages/discord-plays-mario-kart/spaghetti-src/",
      "packages/discord-plays-pokemon/wasm-src/",
      "packages/discord-plays-pokemon/packages/frontend/",
    ]) {
      expect(
        arcade.some((path) => path.startsWith(upstream)),
        upstream,
      ).toBe(true);
    }
    expect(() => dockerStages("FROM ${UNSET} AS stage")).toThrow(
      "unresolved FROM",
    );

    const { report } = await selectImageTargetsWithReasons(
      [...new Set([...required.values()].flatMap((files) => [...files]))],
      REPO_ROOT,
      {},
    );
    expect(report.mode).toBe("selected");
    const unselected = [...required].flatMap(([target, files]) => {
      const attributed = new Set(
        (report.targets[target] ?? []).map(
          (reason) => /^[a-z ]+: (\S+)/.exec(reason)?.[1],
        ),
      );
      return [...files]
        .filter((path) => !attributed.has(path))
        .map((path) => `${target}: ${path}`);
    });
    expect(unselected).toEqual([]);
  },
  GUARD_TIMEOUT_MS,
);

test("every manifests stage copies exactly the manifests every workspace needs", async () => {
  const bake = bakeTargets(
    await Bun.file(nodePath.join(REPO_ROOT, "docker-bake.hcl")).text(),
  );
  // Image targets and the named-context targets they build from; `_app` is
  // an abstract parent with no Dockerfile of its own.
  const upstreams = new Set(
    [...bake.values()].flatMap(({ contexts }) =>
      [...contexts.values()]
        .filter((value) => value.startsWith("target:"))
        .map((value) => value.slice("target:".length)),
    ),
  );
  const built = [...bake.values()].filter(
    ({ name }) => SELECTOR_TARGETS.has(name) || upstreams.has(name),
  );
  const projections = new Map<string, string[]>();
  for (const { dockerfile } of built) {
    const text = await Bun.file(nodePath.join(REPO_ROOT, dockerfile)).text();
    for (const stage of dockerStages(text)) {
      const projects = stage.instructions.some((instruction) =>
        instruction.args.join(" ").startsWith(PROJECTION),
      );
      if (!projects) continue;
      projections.set(
        dockerfile,
        stage.instructions
          .filter(
            ({ keyword, args }) =>
              keyword === "COPY" && args.at(-1) === "/workspace/",
          )
          .flatMap(({ args }) =>
            args.filter((arg) => !arg.startsWith("--")).slice(0, -1),
          ),
      );
    }
  }
  expect(projections.size).toBeGreaterThanOrEqual(23);
  for (const [dockerfile, sources] of projections) {
    expect(sources, dockerfile).toEqual(MANIFESTS_STAGE_SOURCES);
  }
  // workspace-manifests.ts loads every root workspace's manifest from
  // /workspace, so one these globs miss breaks every application image.
  const root: unknown = await Bun.file(
    nodePath.join(REPO_ROOT, "package.json"),
  ).json();
  const workspaces =
    typeof root === "object" && root !== null && "workspaces" in root
      ? root.workspaces
      : undefined;
  if (!Array.isArray(workspaces))
    throw new TypeError("root workspaces missing");
  expect(workspaces.length).toBeGreaterThan(100);
  expect(
    workspaces.filter(
      (dir) => typeof dir !== "string" || !manifestsStageCopies(dir),
    ),
  ).toEqual([]);
  expect(manifestsStageCopies("packages/homelab/src/new-tool")).toBe(false);
});

test(
  "every first-party file Temporal's build-stage bundles read selects it",
  async () => {
    // Temporal's build stage copies all of packages/homelab, so the guard
    // above trusts its partial homelab list for build-only files. The bundles
    // that stage compiles must stay inside what the list and closure select.
    const inputs = new Set<string>();
    for (const [entry, external] of [
      ["packages/homelab/scripts/argocd/argocd.ts", []],
      ["packages/toolkit/src/index.ts", ["ffmpeg-static"]],
    ] as const) {
      const result = await Bun.build({
        entrypoints: [nodePath.join(REPO_ROOT, entry)],
        target: "bun",
        external: [...external],
        metafile: true,
      });
      expect(result.success, entry).toBe(true);
      for (const input of Object.keys(result.metafile?.inputs ?? {})) {
        const path = nodePath.relative(REPO_ROOT, nodePath.resolve(input));
        if (!path.startsWith("..") && !path.includes("node_modules/")) {
          inputs.add(path);
        }
      }
    }
    expect(inputs.has("packages/homelab/src/delivery-ownership.ts")).toBe(true);
    const { report } = await selectImageTargetsWithReasons(
      [...inputs],
      REPO_ROOT,
      {},
    );
    const attributed = new Set(
      (report.targets["temporal-worker"] ?? []).map(
        (reason) => /^[a-z ]+: (\S+)/.exec(reason)?.[1],
      ),
    );
    expect([...inputs].filter((path) => !attributed.has(path))).toEqual([]);
  },
  GUARD_TIMEOUT_MS,
);
