/**
 * `toolkit mc build component …`: browse mc-build's shared components and
 * propose a build-local helper as a new one. Proposing copies the helper into
 * `packages/mc-build/components/<name>/`, writes meta.json, derives a demo
 * from the build program that used it, renders demo.png and prints the
 * review checklist; a PR (with a test) makes it shared.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  ComponentMetaSchema,
  ComponentNameSchema,
  filterComponents,
  findComponent,
  listComponents,
  type ComponentEntry,
} from "@shepherdjerred/mc-build/catalog/components.ts";
import { compileProgram } from "@shepherdjerred/mc-build/compile/runner.ts";
import {
  BuildProgramError,
  COMPONENT_PREFIX,
  COMPONENTS_DIR,
  scanProgram,
} from "@shepherdjerred/mc-build/compile/scan.ts";
import { ensureAssets } from "@shepherdjerred/mc-build/render/assets.ts";
import {
  encodePng,
  Renderer,
  wantsHero,
} from "@shepherdjerred/mc-build/render/index.ts";
import { BUILD_FILES } from "#protocol/build.ts";

export type ComponentRow = {
  name: string;
  description: string;
  tags: string[];
  specifier: string;
};

function row(entry: ComponentEntry): ComponentRow {
  return {
    name: entry.name,
    description: entry.meta.description,
    tags: entry.meta.tags,
    specifier: entry.specifier,
  };
}

export async function componentList(query: {
  tags: readonly string[];
  text?: string;
}): Promise<ComponentRow[]> {
  return filterComponents(await listComponents(), query).map((entry) =>
    row(entry),
  );
}

export async function componentShow(name: string): Promise<
  ComponentRow & {
    exports: string[];
    entry: string;
    demo: string;
    render: string;
    source: string;
  }
> {
  const entry = await findComponent(name);
  return {
    ...row(entry),
    exports: entry.meta.exports,
    entry: entry.entry,
    demo: entry.demo,
    render: entry.render,
    source: await Bun.file(entry.entry).text(),
  };
}

/** Compiles a demo program and writes its hero (or contact sheet) PNG. */
export async function renderDemo(demo: string, out: string): Promise<string> {
  const compiled = await compileProgram({
    program: demo,
    seed: 1,
    anchor: { x: 0, y: 0, z: 0 },
    site: null,
  });
  const renderer = new Renderer(await ensureAssets());
  const image = wantsHero(compiled.grid)
    ? await renderer.hero(compiled.grid)
    : await renderer.sheet(compiled.grid, {
        title: path.basename(path.dirname(demo)),
        subtitle: "COMPONENT DEMO",
      });
  await Bun.write(out, await encodePng(image));
  return out;
}

const DEMO_SKELETON = (
  name: string,
): string => `import type { BuildProgram } from "@shepherdjerred/mc-build/dsl/context.ts";
// TODO: import the exports you want to show and call them below.
import * as component from "${COMPONENT_PREFIX}${name}/index.ts";

/** Demo for the ${name} component: show every export at a readable size. */
export default ((ctx) => {
  ctx.fill({ x: 0, y: 0, z: 0, w: 48, h: 1, d: 48 }, "grass_block");
  void component;
}) satisfies BuildProgram;
`;

/**
 * The build program that used the helper, with its import pointed at the new
 * component, when that program imports nothing else local; otherwise null.
 */
async function demoFromBuild(
  dir: string,
  helper: string,
  name: string,
): Promise<string | null> {
  const program = path.join(dir, BUILD_FILES.program);
  const file = Bun.file(program);
  if (!(await file.exists())) {
    return null;
  }
  const source = await file.text();
  const specifiers = new Bun.Transpiler({ loader: "ts" })
    .scanImports(source)
    .map((entry) => entry.path);
  const local = specifiers.filter(
    (s) => s.startsWith("./") || s.startsWith("../"),
  );
  const own = local.filter((s) => path.resolve(dir, s) === helper);
  if (own.length === 0 || own.length !== local.length) {
    return null;
  }
  let demo = source;
  for (const specifier of own) {
    demo = demo.replaceAll(
      `"${specifier}"`,
      `"${COMPONENT_PREFIX}${name}/index.ts"`,
    );
  }
  return demo;
}

export type ProposeResult = {
  name: string;
  dir: string;
  specifier: string;
  demo: string;
  /** Null when the demo is a skeleton that still needs writing. */
  render: string | null;
  checklist: string[];
};

export async function componentPropose(options: {
  dir: string;
  file: string;
  name: string;
  description: string;
  tags: readonly string[];
}): Promise<ProposeResult> {
  const name = ComponentNameSchema.parse(options.name);
  const buildDir = path.resolve(options.dir);
  const helper = path.resolve(buildDir, options.file);
  const relative = path.relative(buildDir, helper);
  if (relative.startsWith("..") || !helper.endsWith(".ts")) {
    throw new BuildProgramError(
      `${options.file} must be a .ts file inside ${buildDir}`,
    );
  }
  const source = await Bun.file(helper).text();
  const imports = scanProgram(source, helper);
  const local = imports.filter((s) => !s.startsWith(COMPONENT_PREFIX));
  if (local.length > 0) {
    throw new BuildProgramError(
      `${options.file} imports other build-local files (${local.join(", ")}); a component must be self-contained apart from other components — inline them first.`,
    );
  }
  const target = path.join(COMPONENTS_DIR, name);
  if (await Bun.file(path.join(target, "meta.json")).exists()) {
    throw new Error(`components/${name} already exists; choose another --name`);
  }
  await mkdir(target, { recursive: true });
  await Bun.write(path.join(target, "index.ts"), source);
  const meta = ComponentMetaSchema.parse({
    name,
    description: options.description,
    tags: [...options.tags],
    exports: [...source.matchAll(/^export (?:async )?function (\w+)/gmu)].map(
      (match) => `${match[1] ?? ""}(…) — describe the parameters`,
    ),
  });
  await Bun.write(
    path.join(target, "meta.json"),
    `${JSON.stringify(meta, null, 2)}\n`,
  );
  const derived = await demoFromBuild(buildDir, helper, name);
  const demo = path.join(target, "demo.ts");
  await Bun.write(demo, derived ?? DEMO_SKELETON(name));
  const render =
    derived === null
      ? null
      : await renderDemo(demo, path.join(target, "demo.png"));
  return {
    name,
    dir: target,
    specifier: `${COMPONENT_PREFIX}${name}/index.ts`,
    demo,
    render,
    checklist: [
      render === null
        ? `write ${demo} (show every export), then render it: toolkit mc build component render ${name}`
        : `look at ${render}: does it show the component well?`,
      `describe each export's parameters in ${path.join(target, "meta.json")}`,
      `add a unit test in packages/mc-build/test/ that exercises the exports`,
      "bunx turbo run typecheck test lint --filter=@shepherdjerred/mc-build",
      "open a PR with the render attached; components become shared when merged",
    ],
  };
}

/** Re-renders a component's demo.png from its demo.ts. */
export async function componentRender(name: string): Promise<string> {
  const entry = await findComponent(name);
  return renderDemo(entry.demo, entry.render);
}
