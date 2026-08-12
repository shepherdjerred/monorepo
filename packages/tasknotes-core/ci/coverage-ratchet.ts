import path from "node:path";

const workspaceRoot = path.resolve(import.meta.dir, "..");
const repositoryRoot = path.resolve(workspaceRoot, "..", "..");
const baselinePath = path.join(workspaceRoot, "coverage-baseline.json");
const coveragePath = path.join(
  workspaceRoot,
  "artifacts",
  "coverage.cobertura.xml",
);
const baselineDocument: unknown = await Bun.file(baselinePath).json();
if (
  typeof baselineDocument !== "object" ||
  baselineDocument === null ||
  !("schemaVersion" in baselineDocument) ||
  baselineDocument.schemaVersion !== 1 ||
  !("overallLine" in baselineDocument) ||
  typeof baselineDocument.overallLine !== "number" ||
  !("changedLine" in baselineDocument) ||
  typeof baselineDocument.changedLine !== "number"
) {
  throw new Error("TaskNotes Rust coverage baseline has an invalid schema.");
}
const baseline = {
  overallLine: baselineDocument.overallLine,
  changedLine: baselineDocument.changedLine,
};
const baseReference = Bun.env["TASKNOTES_COVERAGE_BASE"] ?? "origin/main";
const baseRevision = Bun.spawnSync(
  ["git", "rev-parse", "--verify", `${baseReference}^{commit}`],
  { cwd: repositoryRoot, stdout: "ignore", stderr: "pipe" },
);
if (baseRevision.exitCode !== 0) {
  throw new Error(
    `Could not resolve Rust coverage baseline reference ${baseReference}: ${new TextDecoder().decode(baseRevision.stderr).trim()}`,
  );
}
const previousPath = "packages/tasknotes-core/coverage-baseline.json";
if (
  Bun.spawnSync(["git", "cat-file", "-e", `${baseReference}:${previousPath}`], {
    cwd: repositoryRoot,
    stdout: "ignore",
    stderr: "ignore",
  }).exitCode === 0
) {
  const previousProcess = Bun.spawnSync(
    ["git", "show", `${baseReference}:${previousPath}`],
    { cwd: repositoryRoot, stdout: "pipe", stderr: "pipe" },
  );
  if (previousProcess.exitCode !== 0) {
    throw new Error(
      `Could not read the prior Rust coverage baseline: ${new TextDecoder().decode(previousProcess.stderr).trim()}`,
    );
  }
  const previousDocument: unknown = JSON.parse(
    new TextDecoder().decode(previousProcess.stdout),
  );
  if (
    typeof previousDocument !== "object" ||
    previousDocument === null ||
    !("overallLine" in previousDocument) ||
    typeof previousDocument.overallLine !== "number" ||
    !("changedLine" in previousDocument) ||
    typeof previousDocument.changedLine !== "number"
  ) {
    throw new Error("The prior Rust coverage baseline has an invalid schema.");
  }
  if (
    baseline.overallLine < previousDocument.overallLine ||
    baseline.changedLine < previousDocument.changedLine
  ) {
    throw new Error("Rust coverage baselines may only hold or increase.");
  }
}

const coverage = await Bun.file(coveragePath).text();
const root = /<coverage\b[^>]*\bline-rate="([\d.]+)"[^>]*>/u.exec(coverage);
if (root?.[1] === undefined) {
  throw new Error("Rust Cobertura report is missing its root line rate.");
}
const overallLine = Math.round(Number(root[1]) * 1000) / 10;
if (overallLine < baseline.overallLine) {
  throw new Error(
    `Rust line coverage ${overallLine.toFixed(1)}% is below baseline ${baseline.overallLine.toFixed(1)}%.`,
  );
}

const executable = new Map<string, number>();
for (const classMatch of coverage.matchAll(
  /<class\b[^>]*\bfilename="([^"]+)"[^>]*>([\s\S]*?)<\/class>/gu,
)) {
  const rawFilename = classMatch[1];
  const body = classMatch[2];
  if (rawFilename === undefined || body === undefined) {
    throw new Error("Rust Cobertura contained an incomplete class record.");
  }
  const filename = `packages/tasknotes-core/${rawFilename.replaceAll("\\", "/")}`;
  if (!isRatchetedSource(filename)) {
    continue;
  }
  for (const lineMatch of body.matchAll(
    /<line\b[^>]*\bhits="(\d+)"[^>]*\bnumber="(\d+)"[^>]*\/>/gu,
  )) {
    const hits = lineMatch[1];
    const number = lineMatch[2];
    if (hits === undefined || number === undefined) {
      throw new Error("Rust Cobertura contained an incomplete line record.");
    }
    const key = `${filename}:${number}`;
    executable.set(key, Math.max(executable.get(key) ?? 0, Number(hits)));
  }
}

const changed = new Set<string>();
for (const command of [
  [
    "git",
    "diff",
    "--unified=0",
    "--no-color",
    `${baseReference}...HEAD`,
    "--",
    "packages/tasknotes-core",
  ],
  [
    "git",
    "diff",
    "--unified=0",
    "--no-color",
    "HEAD",
    "--",
    "packages/tasknotes-core",
  ],
  [
    "git",
    "diff",
    "--cached",
    "--unified=0",
    "--no-color",
    "HEAD",
    "--",
    "packages/tasknotes-core",
  ],
]) {
  const diff = Bun.spawnSync(command, {
    cwd: repositoryRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (diff.exitCode !== 0) {
    throw new Error(
      `Could not calculate Rust changed lines: ${new TextDecoder().decode(diff.stderr).trim()}`,
    );
  }
  addChangedLines(changed, new TextDecoder().decode(diff.stdout));
}
const changedExecutable = [...executable].filter(([key]) => changed.has(key));
if (changedExecutable.length > 0) {
  const covered = changedExecutable.filter(([, hits]) => hits > 0).length;
  const changedLine =
    Math.round((covered / changedExecutable.length) * 1000) / 10;
  if (changedLine < baseline.changedLine) {
    const uncovered = changedExecutable
      .filter(([, hits]) => hits === 0)
      .map(([key]) => key)
      .slice(0, 30);
    throw new Error(
      `Rust client/FFI changed-line coverage ${changedLine.toFixed(1)}% is below ${baseline.changedLine.toFixed(1)}%. Uncovered changed lines:\n${uncovered.join("\n")}`,
    );
  }
  await Bun.write(
    Bun.stdout,
    `TaskNotes Rust coverage: ${overallLine.toFixed(1)}% overall lines, ${changedLine.toFixed(1)}% changed client/FFI lines.\n`,
  );
} else {
  await Bun.write(
    Bun.stdout,
    `TaskNotes Rust coverage: ${overallLine.toFixed(1)}% overall lines; no changed executable client/FFI lines.\n`,
  );
}

function isRatchetedSource(filename: string): boolean {
  return (
    filename.startsWith(
      "packages/tasknotes-core/crates/tasknotes-core/src/net/",
    ) ||
    (filename.startsWith(
      "packages/tasknotes-core/crates/tasknotes-core-ffi/src/",
    ) &&
      !filename.includes("/src/bin/"))
  );
}

function addChangedLines(target: Set<string>, diff: string): void {
  let file: string | undefined;
  for (const line of diff.split(/\r?\n/u)) {
    if (line.startsWith("+++ b/")) {
      file = line.slice(6);
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/u.exec(line);
    if (file === undefined || hunk?.[1] === undefined) {
      continue;
    }
    const start = Number(hunk[1]);
    const count = Number(hunk[2] ?? "1");
    for (let offset = 0; offset < count; offset += 1) {
      target.add(`${file}:${String(start + offset)}`);
    }
  }
}
