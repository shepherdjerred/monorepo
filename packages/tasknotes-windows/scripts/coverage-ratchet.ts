import path from "node:path";
import { XMLParser } from "fast-xml-parser";
import { z } from "zod";

const packageRoot = path.resolve(import.meta.dir, "..");
const repositoryRoot = path.resolve(packageRoot, "..", "..");
const baselinePath = path.join(packageRoot, "coverage-baseline.json");
const portableOnly = Bun.argv.includes("--portable");
const BaselineSchema = z.object({
  schemaVersion: z.literal(1),
  components: z.record(
    z.string(),
    z.object({
      line: z.number().min(0).max(100),
      branch: z.number().min(0).max(100),
    }),
  ),
  portableComponents: z.record(
    z.string(),
    z.object({
      line: z.number().min(0).max(100),
      branch: z.number().min(0).max(100),
    }),
  ),
  changedLineMinimums: z.record(z.string(), z.number().min(0).max(100)),
});
const DocumentSchema = z.object({
  coverage: z.object({
    packages: z.object({ package: z.unknown() }),
  }),
});
const PackageSchema = z.object({
  "@_name": z.string(),
  classes: z.object({ class: z.unknown() }),
});
const ClassSchema = z.object({
  "@_filename": z.string(),
  lines: z.object({ line: z.unknown() }),
});
const LineSchema = z.object({
  "@_number": z.coerce.number().int().positive(),
  "@_hits": z.coerce.number().int().nonnegative(),
  "@_condition-coverage": z.string().optional(),
});
type LineReading = {
  hits: number;
  branchesCovered: number;
  branchesValid: number;
};

function many(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value];
}

function branchReading(raw: string | undefined): {
  covered: number;
  valid: number;
} {
  if (raw === undefined) {
    return { covered: 0, valid: 0 };
  }
  const match = /\((\d+)\/(\d+)\)/u.exec(raw);
  if (match?.[1] === undefined || match[2] === undefined) {
    throw new Error(`Unrecognized Cobertura condition coverage '${raw}'.`);
  }
  return { covered: Number(match[1]), valid: Number(match[2]) };
}

const requiredSuites = portableOnly
  ? ["unit", "integration"]
  : ["unit", "integration", "winui"];
const coverageFiles = requiredSuites.map((suite) =>
  path.join(
    packageRoot,
    "artifacts",
    "test-results",
    suite,
    "coverage.cobertura.xml",
  ),
);
const parser = new XMLParser({ ignoreAttributes: false });
const suiteComponents: ReadonlyMap<string, Map<string, LineReading>>[] = [];
for (const coverageFile of coverageFiles) {
  if (!(await Bun.file(coverageFile).exists())) {
    throw new Error(
      `Missing required Cobertura artifact ${path.relative(packageRoot, coverageFile)}.`,
    );
  }
  const parsed: unknown = parser.parse(await Bun.file(coverageFile).text());
  const document = DocumentSchema.parse(parsed);
  const suiteLines = new Map<string, Map<string, LineReading>>();
  suiteComponents.push(suiteLines);
  for (const packageValue of many(document.coverage.packages.package)) {
    const packageReading = PackageSchema.parse(packageValue);
    for (const classValue of many(packageReading.classes.class)) {
      const classReading = ClassSchema.parse(classValue);
      const relative = path
        .relative(repositoryRoot, classReading["@_filename"])
        .replaceAll("\\", "/");
      if (relative.includes("/obj/") || relative.includes("/bin/")) {
        continue;
      }
      const component = componentForSource(relative);
      if (
        component === undefined ||
        (portableOnly && component === "TaskNotes.Windows.AppAdapters")
      ) {
        continue;
      }
      let lines = suiteLines.get(component);
      if (lines === undefined) {
        lines = new Map();
        suiteLines.set(component, lines);
      }
      for (const lineValue of many(classReading.lines.line)) {
        const line = LineSchema.parse(lineValue);
        const key = `${relative}:${String(line["@_number"])}`;
        const branch = branchReading(line["@_condition-coverage"]);
        const previous = lines.get(key);
        lines.set(key, {
          hits: Math.max(previous?.hits ?? 0, line["@_hits"]),
          branchesCovered: Math.max(
            previous?.branchesCovered ?? 0,
            branch.covered,
          ),
          branchesValid: Math.max(previous?.branchesValid ?? 0, branch.valid),
        });
      }
    }
  }
}
const componentLines = new Map<string, Map<string, LineReading>>();
for (const suite of suiteComponents) {
  for (const [component, suiteLines] of suite) {
    let merged = componentLines.get(component);
    if (merged === undefined) {
      merged = new Map();
      componentLines.set(component, merged);
    }
    // Cobertura reports a line's branch coverage as an aggregate count, and its
    // <condition> children carry only a percentage — neither identifies *which*
    // branch ran. Suites instrument overlapping assemblies, so adding their
    // counts turns two suites that both took the same 1-of-2 branch into 2/2.
    // Take the maximum instead: it can only under-report a branch that two
    // suites genuinely split, which leaves the gate stricter rather than
    // letting an uncovered branch satisfy the baseline.
    for (const [key, reading] of suiteLines) {
      const previous = merged.get(key);
      merged.set(key, {
        hits: Math.max(previous?.hits ?? 0, reading.hits),
        branchesCovered: Math.max(
          previous?.branchesCovered ?? 0,
          reading.branchesCovered,
        ),
        branchesValid: Math.max(
          previous?.branchesValid ?? 0,
          reading.branchesValid,
        ),
      });
    }
  }
}
if (componentLines.size === 0) {
  throw new Error(
    "No Windows Cobertura artifacts were found. Run windows:coverage first.",
  );
}

function percent(covered: number, valid: number): number {
  return valid === 0 ? 100 : Math.round((covered / valid) * 1000) / 10;
}

const failures: string[] = [];
const baseline = BaselineSchema.parse(await Bun.file(baselinePath).json());
const baseReference = Bun.env["TASKNOTES_COVERAGE_BASE"] ?? "origin/main";
const baseRevision = Bun.spawnSync(
  ["git", "rev-parse", "--verify", `${baseReference}^{commit}`],
  { cwd: repositoryRoot, stdout: "ignore", stderr: "pipe" },
);
if (baseRevision.exitCode !== 0) {
  throw new Error(
    `Could not resolve coverage baseline reference ${baseReference}: ${new TextDecoder().decode(baseRevision.stderr).trim()}`,
  );
}
const baselineRepositoryPath =
  "packages/tasknotes-windows/coverage-baseline.json";
const previousBaselineExists = Bun.spawnSync(
  ["git", "cat-file", "-e", `${baseReference}:${baselineRepositoryPath}`],
  { cwd: repositoryRoot, stdout: "ignore", stderr: "ignore" },
).exitCode;
if (previousBaselineExists === 0) {
  const previousDocument = Bun.spawnSync(
    ["git", "show", `${baseReference}:${baselineRepositoryPath}`],
    { cwd: repositoryRoot, stdout: "pipe", stderr: "pipe" },
  );
  if (previousDocument.exitCode !== 0) {
    throw new Error(
      `Could not read the prior coverage baseline: ${new TextDecoder().decode(previousDocument.stderr).trim()}`,
    );
  }
  const previous = BaselineSchema.parse(
    JSON.parse(new TextDecoder().decode(previousDocument.stdout)),
  );
  requireNondecreasingBaselines(previous, baseline);
}
const expectedComponents = portableOnly
  ? baseline.portableComponents
  : baseline.components;
for (const [component, expected] of Object.entries(expectedComponents)) {
  const lines = componentLines.get(component);
  if (lines === undefined) {
    failures.push(`${component} has no coverage artifact.`);
    continue;
  }
  const values = [...lines.values()];
  const line = percent(
    values.filter((reading) => reading.hits > 0).length,
    values.length,
  );
  const branchesCovered = values.reduce(
    (total, reading) => total + reading.branchesCovered,
    0,
  );
  const branchesValid = values.reduce(
    (total, reading) => total + reading.branchesValid,
    0,
  );
  const branch = percent(branchesCovered, branchesValid);
  await Bun.write(
    Bun.stdout,
    `${component}: ${line.toFixed(1)}% lines, ${branch.toFixed(1)}% branches\n`,
  );
  if (line + 0.0001 < expected.line) {
    failures.push(
      `${component} line coverage ${line.toFixed(1)}% is below baseline ${expected.line.toFixed(1)}%.`,
    );
  }
  if (branch + 0.0001 < expected.branch) {
    failures.push(
      `${component} branch coverage ${branch.toFixed(1)}% is below baseline ${expected.branch.toFixed(1)}%.`,
    );
  }
}

const diff = Bun.spawnSync(
  [
    "git",
    "diff",
    "--unified=0",
    "--no-color",
    `${baseReference}...HEAD`,
    "--",
    "packages/tasknotes-windows",
  ],
  { cwd: repositoryRoot, stdout: "pipe", stderr: "pipe" },
);
if (diff.exitCode !== 0) {
  throw new Error(
    `Could not calculate changed lines from ${baseReference}: ${new TextDecoder().decode(diff.stderr).trim()}`,
  );
}
const workingDiff = Bun.spawnSync(
  [
    "git",
    "diff",
    "--unified=0",
    "--no-color",
    "HEAD",
    "--",
    "packages/tasknotes-windows",
  ],
  { cwd: repositoryRoot, stdout: "pipe", stderr: "pipe" },
);
if (workingDiff.exitCode !== 0) {
  throw new Error(
    `Could not calculate working-tree changed lines: ${new TextDecoder().decode(workingDiff.stderr).trim()}`,
  );
}
const stagedDiff = Bun.spawnSync(
  [
    "git",
    "diff",
    "--cached",
    "--unified=0",
    "--no-color",
    "HEAD",
    "--",
    "packages/tasknotes-windows",
  ],
  { cwd: repositoryRoot, stdout: "pipe", stderr: "pipe" },
);
if (stagedDiff.exitCode !== 0) {
  throw new Error(
    `Could not calculate staged changed lines: ${new TextDecoder().decode(stagedDiff.stderr).trim()}`,
  );
}

function changedLines(raw: string): Set<string> {
  const changed = new Set<string>();
  let file: string | undefined;
  for (const line of raw.split(/\r?\n/u)) {
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
    for (let offset = 0; offset < count; offset++) {
      changed.add(`${file}:${String(start + offset)}`);
    }
  }
  return changed;
}

const changed = changedLines(
  `${new TextDecoder().decode(diff.stdout)}\n${new TextDecoder().decode(workingDiff.stdout)}\n${new TextDecoder().decode(stagedDiff.stdout)}`,
);
const untracked = Bun.spawnSync(
  [
    "git",
    "ls-files",
    "--others",
    "--exclude-standard",
    "--",
    "packages/tasknotes-windows",
  ],
  { cwd: repositoryRoot, stdout: "pipe", stderr: "pipe" },
);
if (untracked.exitCode !== 0) {
  throw new Error(
    `Could not enumerate untracked Windows sources: ${new TextDecoder().decode(untracked.stderr).trim()}`,
  );
}
for (const file of new TextDecoder()
  .decode(untracked.stdout)
  .split(/\r?\n/u)
  .filter(Boolean)) {
  if (!file.endsWith(".cs")) {
    continue;
  }
  const contents = await Bun.file(path.join(repositoryRoot, file)).text();
  const count = contents.split(/\r?\n/u).length;
  for (let line = 1; line <= count; line++) {
    changed.add(`${file}:${String(line)}`);
  }
}
for (const [component, minimum] of Object.entries(
  baseline.changedLineMinimums,
)) {
  if (portableOnly && component === "TaskNotes.Windows.AppAdapters") {
    continue;
  }
  const lines = componentLines.get(component);
  const coveredLines =
    lines === undefined
      ? []
      : [...lines.entries()].filter(([key]) => changed.has(key));
  const changedComponentLines = [...changed].filter(
    (key) =>
      componentForSource(key.slice(0, key.lastIndexOf(":"))) === component,
  );
  if (changedComponentLines.length === 0) {
    continue;
  }
  // The guard here is that a changed source *file* reached the coverage run at
  // all: a file left out of the portable solution, or excluded by the coverage
  // settings, would otherwise pass this gate by producing no data to measure.
  // Whether the individual changed lines are executable is a different
  // question — a comment, an attribute, or an accessibility modifier changes
  // real source and instruments nothing, and must not read as uninstrumented.
  const instrumentedFiles = new Set(
    [...(lines?.keys() ?? [])].map((key) => key.slice(0, key.lastIndexOf(":"))),
  );
  const uninstrumentedFiles = [
    ...new Set(
      changedComponentLines.map((key) => key.slice(0, key.lastIndexOf(":"))),
    ),
  ]
    .filter((file) => !instrumentedFiles.has(file))
    .sort();
  if (uninstrumentedFiles.length > 0) {
    failures.push(
      `${component} has changed source that the coverage run never instrumented: ${uninstrumentedFiles.join(", ")}.`,
    );
    continue;
  }
  if (coveredLines.length === 0) {
    continue;
  }
  const coverage = percent(
    coveredLines.filter(([, reading]) => reading.hits > 0).length,
    coveredLines.length,
  );
  await Bun.write(
    Bun.stdout,
    `${component}: ${coverage.toFixed(1)}% changed executable lines (${String(coveredLines.length)} lines)\n`,
  );
  if (coverage + 0.0001 < minimum) {
    failures.push(
      `${component} changed-line coverage ${coverage.toFixed(1)}% is below ${minimum.toFixed(1)}%.`,
    );
  }
}

function componentForSource(relative: string): string | undefined {
  if (
    relative.includes("/src/TaskNotes.Windows.Host/") ||
    relative.startsWith(
      "packages/tasknotes-windows/src/TaskNotes.Windows.Host/",
    )
  ) {
    return "TaskNotes.Windows.Host";
  }
  if (
    relative.includes("/src/TaskNotes.Windows.Presentation/") ||
    relative.startsWith(
      "packages/tasknotes-windows/src/TaskNotes.Windows.Presentation/",
    )
  ) {
    return "TaskNotes.Windows.Presentation";
  }
  if (
    relative.endsWith("/src/TaskNotes.Windows.App/HotkeyBinding.cs") ||
    relative.endsWith("/src/TaskNotes.Windows.App/ShellPreferencesCodec.cs") ||
    relative.endsWith("/src/TaskNotes.Windows.App/UiOperationQueue.cs") ||
    relative.endsWith("/src/TaskNotes.Windows.App/WinUiDispatcher.cs")
  ) {
    return "TaskNotes.Windows.AppAdapters";
  }
  return undefined;
}

function requireNondecreasingBaselines(
  previous: z.infer<typeof BaselineSchema>,
  current: z.infer<typeof BaselineSchema>,
): void {
  for (const key of ["components", "portableComponents"] as const) {
    for (const [component, expected] of Object.entries(previous[key])) {
      const actual = current[key][component];
      if (actual === undefined) {
        failures.push(
          `${key}.${component} was removed from the coverage baseline.`,
        );
        continue;
      }
      if (actual.line < expected.line || actual.branch < expected.branch) {
        failures.push(
          `${key}.${component} decreased from ${expected.line.toFixed(1)}% lines/${expected.branch.toFixed(1)}% branches to ${actual.line.toFixed(1)}%/${actual.branch.toFixed(1)}%.`,
        );
      }
    }
  }
}

if (failures.length > 0) {
  throw new Error(
    `Windows coverage ratchet failed:\n\n${failures.map((failure) => `- ${failure}`).join("\n")}`,
  );
}
