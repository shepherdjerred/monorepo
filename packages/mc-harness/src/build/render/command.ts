import { BuildWorkspace } from "#build/workspace.ts";
import type { BlockPos } from "#protocol/bridge.ts";
import { BUILD_FILES } from "#protocol/build.ts";
import { checkName, readRenderProvenance } from "#build/sidecar.ts";
import {
  alignedComparison,
  cropToBox,
  gridFor,
  isPlainLook,
  regionInSite,
  type RenderSource,
} from "#build/sources.ts";
import { publishFiles } from "#build/file-transaction.ts";
import {
  renderGrid,
  localCuts,
  renderHero,
  renderLooks,
  type Env,
  type LookOptions,
} from "#build/helpers.ts";
import { recordRender, relativeFiles } from "./record.ts";
import {
  stageJournal,
  stagedFiles,
} from "#build/storage/evidence-publication.ts";

export async function renderBuildCommand(
  env: Env,
  dir: string,
  options: {
    target?: string;
    source?: RenderSource;
    /** Same as `source: "expected"`; kept for older callers. */
    expected?: boolean;
    name?: string;
    /** A close-up inside the site box (maps: one district at a time). */
    region?: { min: BlockPos; max: BlockPos };
    look?: LookOptions;
    /** Name of an earlier render whose `.schem` sidecar to compare against. */
    compare?: string;
  },
): Promise<{
  render: string;
  hero: string | null;
  files: Record<string, string>;
  skipped: string[];
}> {
  const workspace = new BuildWorkspace(dir);
  const manifest = await workspace.manifest();
  const site = workspace.siteBox(manifest);
  const source: RenderSource =
    options.source ?? (options.expected === true ? "expected" : "canvas");
  const box =
    options.region === undefined ? site : regionInSite(site, options.region);
  const { grid: whole, skipped } = await gridFor(env, workspace, manifest, {
    source,
    box: site,
    ...(options.target === undefined ? {} : { target: options.target }),
  });
  const grid = cropToBox(whole, site, box);
  if (skipped.length > 0) {
    throw new Error(
      `cannot render incomplete compiled evidence: ${skipped.join("; ")}; run the build and render --source expected or --source canvas`,
    );
  }
  const name = checkName(
    "render",
    options.name ?? `render-${Date.now().toString(36)}`,
  );
  const look: LookOptions = localCuts(
    { ...options.look },
    manifest.anchor,
    box.min,
  );
  const covered = { min: box.min, max: box.max };
  if (options.compare !== undefined) {
    const earlier = await alignedComparison(
      workspace,
      options.compare,
      covered,
    );
    look.compareWith = earlier.grid;
    look.compareContext = earlier.context;
  }
  look.source = source;
  if (options.target !== undefined) look.target = options.target;
  look.box = covered;
  if (options.region !== undefined) {
    look.regionContext = {
      grid: whole,
      origin: {
        x: box.min.x - site.min.x,
        y: box.min.y - site.min.y,
        z: box.min.z - site.min.z,
      },
    };
  }
  const provenance = await readRenderProvenance(
    workspace,
    source,
    options.target,
  );
  let files: Record<string, string> = {};
  await publishFiles(workspace, {
    prefix: ".render-",
    stage: async (staged) => {
      const pending = new BuildWorkspace(staged);
      let generated: Record<string, string>;
      if (isPlainLook(look) && options.region === undefined) {
        const render = await renderGrid(pending, grid, name, manifest.name);
        const hero = await renderHero(pending, grid, name);
        generated = { sheet: render, ...(hero === null ? {} : { hero }) };
        await recordRender(pending, grid, {
          name,
          files: generated,
          source,
          provenance,
          box: covered,
        });
      } else
        generated = await renderLooks(pending, grid, name, {
          ...look,
          provenance,
        });
      const relative = relativeFiles(pending, generated);
      files = Object.fromEntries(
        Object.entries(relative).map(([key, file]) => [
          key,
          workspace.file(file),
        ]),
      );
      await stageJournal(workspace, pending, {
        kind: "render",
        name,
        source,
        files: Object.values(relative),
      });
      const artifacts = await stagedFiles(staged);
      return [
        ...artifacts.filter((file) => file !== BUILD_FILES.journal),
        BUILD_FILES.journal,
      ];
    },
  });
  return {
    render:
      files["sheet"] ?? files["elevations"] ?? Object.values(files)[0] ?? "",
    hero: files["hero"] ?? null,
    files,
    skipped,
  };
}
