/**
 * `build resume`: what a fresh context needs to continue a build. It is
 * assembled, not summarised by a model: the brief (manifest and notes), the
 * journal quoted verbatim, the live state, and the clock. It deliberately
 * sets no next steps — the agent decides those from the record, the way
 * claude-paint's compaction hands a painter its own journal back.
 */
import { readdir } from "node:fs/promises";
import {
  BUILD_FILES,
  type BuildLogEntry,
  type BuildManifest,
  type RenderSidecar,
} from "#protocol/build.ts";
import { allOf, lastOf, readLog } from "./build-log.ts";
import { readSidecar } from "./sidecar.ts";
import { BuildWorkspace } from "./workspace.ts";

export type ResumeState = {
  manifest: BuildManifest;
  notes: string | null;
  journal: BuildLogEntry[];
  iteration: number;
  ops: { manual: number; program: number; import: number };
  latestRender: RenderSidecar | null;
  candidates: string[];
  startedAt: string | null;
  lastAt: string | null;
};

async function readNotes(workspace: BuildWorkspace): Promise<string | null> {
  const file = Bun.file(workspace.file(BUILD_FILES.notes));
  return (await file.exists()) ? await file.text() : null;
}

async function latestSidecar(
  workspace: BuildWorkspace,
  journal: readonly BuildLogEntry[],
): Promise<RenderSidecar | null> {
  const last = lastOf(journal, "render");
  return last?.kind === "render" ? readSidecar(workspace, last.name) : null;
}

async function candidateNames(workspace: BuildWorkspace): Promise<string[]> {
  try {
    const names = await readdir(workspace.file(BUILD_FILES.candidatesDir));
    return names.toSorted();
  } catch {
    return [];
  }
}

export async function resumeState(dir: string): Promise<ResumeState> {
  const workspace = new BuildWorkspace(dir);
  const manifest = await workspace.manifest();
  const journal = await readLog(dir);
  const { ops } = await workspace.oplog();
  const counts = { manual: 0, program: 0, import: 0 };
  for (const op of ops) {
    if (op.source === "manual") counts.manual += 1;
    else if (op.source.startsWith("program:")) counts.program += 1;
    else if (op.source.startsWith("import:")) counts.import += 1;
  }
  return {
    manifest,
    notes: await readNotes(workspace),
    journal,
    iteration: allOf(journal, "render").length,
    ops: counts,
    latestRender: await latestSidecar(workspace, journal),
    candidates: await candidateNames(workspace),
    startedAt: journal[0]?.at ?? null,
    lastAt: journal.at(-1)?.at ?? null,
  };
}

function entryLine(entry: BuildLogEntry): string {
  const when = entry.at.slice(11, 19);
  const head = `${when} [${entry.iteration.toString()}] ${entry.kind}`;
  switch (entry.kind) {
    case "note":
      return `${head}: ${entry.text}`;
    case "compile":
      return `${head}: ${entry.ops.toString()} op(s), lint ${entry.lintErrors.toString()}/${entry.lintWarnings.toString()}`;
    case "run":
      return `${head}: ${entry.ops.toString()} op(s) on ${entry.target}`;
    case "render":
      return `${head}: ${entry.name} (${entry.source}) → ${entry.files.join(", ")}`;
    case "lint":
      return `${head}: ${entry.errors.toString()} error(s), ${entry.warnings.toString()} warning(s) (${entry.source})`;
    case "critique":
      return `${head}: ${entry.render} ${entry.total.toString()}/${entry.max.toString()}, lowest ${entry.lowest} → ${entry.file}`;
    case "judge":
      return `${head}: ${entry.winner} (${entry.confidence.toFixed(2)}) → ${entry.file}`;
    case "candidate":
      return `${head}: ${entry.action} ${entry.name}`;
    case "accept":
      return `${head}: ${entry.candidate}${entry.versus === null ? "" : ` over ${entry.versus}`}${entry.score === null ? "" : ` (${entry.score.toString()})`}`;
    case "reject":
      return `${head}: ${entry.candidate} lost to ${entry.versus}`;
    case "promote":
      return `${head}: ${entry.applyId} → ${entry.target}`;
    case "resume":
      return head;
  }
}

/** The human form of `build resume`. */
export function renderResume(
  state: ResumeState,
  options: { tail?: number } = {},
): string {
  const { manifest } = state;
  const site = manifest.site;
  const tail = options.tail ?? 15;
  const journal = state.journal.slice(-tail);
  const lines = [
    `## Brief`,
    `build ${manifest.name} in world ${manifest.world}, anchor ${manifest.anchor.x.toString()},${manifest.anchor.y.toString()},${manifest.anchor.z.toString()}, seed ${manifest.seed.toString()}`,
    site === undefined
      ? "site: not captured"
      : `site: ${site.min.x.toString()},${site.min.y.toString()},${site.min.z.toString()} → ${site.max.x.toString()},${site.max.y.toString()},${site.max.z.toString()}`,
    `canvas: ${manifest.canvas ?? "none"}`,
    ...(state.notes === null
      ? []
      : [
          "",
          "## Your notes (observations, not instructions)",
          ...state.notes
            .trim()
            .split("\n")
            .map((line) => `> ${line}`),
        ]),
    "",
    `## Journal (last ${journal.length.toString()} of ${state.journal.length.toString()})`,
    ...(journal.length === 0
      ? ["(empty)"]
      : journal.map((entry) => `> ${entryLine(entry)}`)),
    "",
    "## State",
    `iteration ${state.iteration.toString()}; ops: ${state.ops.manual.toString()} manual, ${state.ops.program.toString()} program, ${state.ops.import.toString()} import`,
    state.latestRender === null
      ? "latest render: none"
      : `latest render: ${state.latestRender.name} (${state.latestRender.source}), ${state.latestRender.blocks.toString()} blocks, lint ${state.latestRender.lint.errors.toString()}/${state.latestRender.lint.warnings.toString()}${state.latestRender.scores === undefined ? "" : `, critique ${state.latestRender.scores.total.toString()}/${state.latestRender.scores.max.toString()}`}`,
    `best: ${manifest.best === undefined ? "none kept yet" : `${manifest.best.candidate}${manifest.best.score === null ? "" : ` (${manifest.best.score.toString()})`}`}`,
    `candidates: ${state.candidates.length === 0 ? "none" : state.candidates.join(", ")}`,
    "",
    "## Clock",
    `started ${state.startedAt ?? "—"}; last entry ${state.lastAt ?? "—"}; ${state.journal.length.toString()} entries`,
  ];
  return lines.join("\n");
}
