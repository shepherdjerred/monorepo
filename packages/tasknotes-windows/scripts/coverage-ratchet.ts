import path from "node:path";
import { XMLParser } from "fast-xml-parser";
import { z } from "zod";
import {
  COMPONENT_METADATA,
  componentForSource,
  isPermittedDeclarationOnlySource,
} from "./lib/coverage-source-inclusion.ts";

const packageRoot = path.resolve(import.meta.dir, "..");
const repositoryRoot = path.resolve(packageRoot, "..", "..");
const baselinePath = path.join(packageRoot, "coverage-baseline.json");

const ThresholdSchema = z.object({
  line: z.number().min(0).max(100),
  branch: z.number().min(0).max(100),
});
const BaselineSchema = z.object({
  schemaVersion: z.literal(1),
  components: z.record(z.string(), ThresholdSchema),
  portableComponents: z.record(z.string(), ThresholdSchema),
  changedLineMinimums: z.record(z.string(), z.number().min(0).max(100)),
});
const DocumentSchema = z.object({
  coverage: z.object({ packages: z.object({ package: z.unknown() }) }),
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

type Baseline = z.infer<typeof BaselineSchema>;
type LineReading = {
  hits: number;
  branchesCovered: number;
  branchesValid: number;
};

const many = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [value];
const percent = (covered: number, valid: number): number =>
  valid === 0 ? 100 : Math.round((covered / valid) * 1000) / 10;

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

function mergeLineReading(
  target: Map<string, LineReading>,
  key: string,
  reading: LineReading,
): void {
  const prev = target.get(key);
  target.set(key, {
    hits: Math.max(prev?.hits ?? 0, reading.hits),
    branchesCovered: Math.max(
      prev?.branchesCovered ?? 0,
      reading.branchesCovered,
    ),
    branchesValid: Math.max(prev?.branchesValid ?? 0, reading.branchesValid),
  });
}

function runGit(args: string[], errorMessage: string): string {
  const res = Bun.spawnSync(["git", ...args], {
    cwd: repositoryRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (res.exitCode !== 0) {
    throw new Error(
      `${errorMessage}: ${new TextDecoder().decode(res.stderr).trim()}`,
    );
  }
  return new TextDecoder().decode(res.stdout);
}

export function changedLines(raw: string): Set<string> {
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

function requireNondecreasingBaselines(
  previous: Baseline,
  current: Baseline,
  failures: string[],
): void {
  for (const key of ["components", "portableComponents"] as const) {
    for (const [component, expected] of Object.entries(previous[key])) {
      const actual = current[key][component];
      if (actual === undefined) {
        failures.push(
          `${key}.${component} was removed from the coverage baseline.`,
        );
      } else if (
        actual.line < expected.line ||
        actual.branch < expected.branch
      ) {
        failures.push(
          `${key}.${component} decreased from ${expected.line.toFixed(1)}% lines/${expected.branch.toFixed(1)}% branches to ${actual.line.toFixed(1)}%/${actual.branch.toFixed(1)}%.`,
        );
      }
    }
  }
}

function recordClassLines(
  classValue: unknown,
  portableOnly: boolean,
  suiteLines: Map<string, Map<string, LineReading>>,
): void {
  const classReading = ClassSchema.parse(classValue);
  const relative = path
    .relative(repositoryRoot, classReading["@_filename"])
    .replaceAll("\\", "/");
  const component =
    relative.includes("/obj/") || relative.includes("/bin/")
      ? undefined
      : componentForSource(relative);
  if (
    component === undefined ||
    (portableOnly && component === "TaskNotes.Windows.AppAdapters")
  ) {
    return;
  }
  let lines = suiteLines.get(component);
  if (lines === undefined) {
    lines = new Map();
    suiteLines.set(component, lines);
  }
  for (const lineValue of many(classReading.lines.line)) {
    const line = LineSchema.parse(lineValue);
    const branch = branchReading(line["@_condition-coverage"]);
    mergeLineReading(lines, `${relative}:${String(line["@_number"])}`, {
      hits: line["@_hits"],
      branchesCovered: branch.covered,
      branchesValid: branch.valid,
    });
  }
}

function mergeSuiteComponents(
  suiteLines: ReadonlyMap<string, Map<string, LineReading>>,
  componentLines: Map<string, Map<string, LineReading>>,
): void {
  for (const [component, lines] of suiteLines) {
    let merged = componentLines.get(component);
    if (merged === undefined) {
      merged = new Map();
      componentLines.set(component, merged);
    }
    for (const [key, reading] of lines) {
      mergeLineReading(merged, key, reading);
    }
  }
}

async function collectComponentLines(
  coverageFiles: readonly string[],
  portableOnly: boolean,
): Promise<Map<string, Map<string, LineReading>>> {
  const parser = new XMLParser({ ignoreAttributes: false });
  const componentLines = new Map<string, Map<string, LineReading>>();
  for (const coverageFile of coverageFiles) {
    if (!(await Bun.file(coverageFile).exists())) {
      throw new Error(
        `Missing required Cobertura artifact ${path.relative(packageRoot, coverageFile)}.`,
      );
    }
    const doc = DocumentSchema.parse(
      parser.parse(await Bun.file(coverageFile).text()),
    );
    const suiteLines = new Map<string, Map<string, LineReading>>();
    for (const pkg of many(doc.coverage.packages.package)) {
      for (const cls of many(PackageSchema.parse(pkg).classes.class)) {
        recordClassLines(cls, portableOnly, suiteLines);
      }
    }
    mergeSuiteComponents(suiteLines, componentLines);
  }
  if (componentLines.size === 0) {
    throw new Error(
      "No Windows Cobertura artifacts were found. Run windows:coverage first.",
    );
  }
  return componentLines;
}

async function collectChangedSet(baseRef: string): Promise<Set<string>> {
  const scope = ["--unified=0", "--no-color"];
  const branch = runGit(
    ["diff", ...scope, `${baseRef}...HEAD`, "--", "packages/tasknotes-windows"],
    `Could not calculate changed lines from ${baseRef}`,
  );
  const working = runGit(
    ["diff", ...scope, "HEAD", "--", "packages/tasknotes-windows"],
    "Could not calculate working-tree changed lines",
  );
  const staged = runGit(
    ["diff", "--cached", ...scope, "HEAD", "--", "packages/tasknotes-windows"],
    "Could not calculate staged changed lines",
  );
  const changed = changedLines(`${branch}\n${working}\n${staged}`);
  const untracked = runGit(
    [
      "ls-files",
      "--others",
      "--exclude-standard",
      "--",
      "packages/tasknotes-windows",
    ],
    "Could not enumerate untracked Windows sources",
  );
  for (const file of untracked
    .split(/\r?\n/u)
    .filter((f) => f.endsWith(".cs"))) {
    const contents = await Bun.file(path.join(repositoryRoot, file)).text();
    const count = contents.split(/\r?\n/u).length;
    for (let line = 1; line <= count; line++) {
      changed.add(`${file}:${String(line)}`);
    }
  }
  return changed;
}

async function isPermittedZeroLineFile(
  component: string,
  relativePath: string,
  portableOnly: boolean,
): Promise<boolean> {
  const meta = COMPONENT_METADATA[component];
  if (meta === undefined) {
    return false;
  }
  const sourceFile = Bun.file(path.join(repositoryRoot, relativePath));
  const solutionFile = Bun.file(
    path.join(
      packageRoot,
      portableOnly
        ? "TaskNotes.Windows.Portable.slnx"
        : "TaskNotes.Windows.slnx",
    ),
  );
  const csprojFile = Bun.file(path.join(packageRoot, meta.projectPath));
  const settingsFile = Bun.file(
    path.join(packageRoot, "coverage.settings.xml"),
  );
  if (
    !(await sourceFile.exists()) ||
    !(await solutionFile.exists()) ||
    !(await csprojFile.exists()) ||
    !(await settingsFile.exists())
  ) {
    return false;
  }
  return isPermittedDeclarationOnlySource({
    relativePath,
    component,
    sourceText: await sourceFile.text(),
    solutionXml: await solutionFile.text(),
    csprojXml: await csprojFile.text(),
    coverageSettingsXml: await settingsFile.text(),
  });
}

async function verifyComponentBaselines(
  expectedComponents: Baseline["components"],
  componentLines: ReadonlyMap<string, Map<string, LineReading>>,
  failures: string[],
): Promise<void> {
  for (const [component, expected] of Object.entries(expectedComponents)) {
    const lines = componentLines.get(component);
    if (lines === undefined) {
      failures.push(`${component} has no coverage artifact.`);
      continue;
    }
    const vals = [...lines.values()];
    const line = percent(vals.filter((r) => r.hits > 0).length, vals.length);
    const branch = percent(
      vals.reduce((sum, r) => sum + r.branchesCovered, 0),
      vals.reduce((sum, r) => sum + r.branchesValid, 0),
    );
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
}

async function findUninstrumentedComponentFiles(
  component: string,
  changedComponentLines: readonly string[],
  lines: ReadonlyMap<string, LineReading> | undefined,
  portableOnly: boolean,
): Promise<string[]> {
  const instrumented = new Set(
    [...(lines?.keys() ?? [])].map((key) => key.slice(0, key.lastIndexOf(":"))),
  );
  const candidates = [
    ...new Set(
      changedComponentLines.map((key) => key.slice(0, key.lastIndexOf(":"))),
    ),
  ].filter((file) => !instrumented.has(file));
  const missing: string[] = [];
  for (const file of candidates) {
    if (!(await isPermittedZeroLineFile(component, file, portableOnly))) {
      missing.push(file);
    }
  }
  return missing.toSorted((a, b) => a.localeCompare(b));
}

async function verifyChangedLines(
  minimums: Readonly<Record<string, number>>,
  componentLines: ReadonlyMap<string, Map<string, LineReading>>,
  changed: ReadonlySet<string>,
  options: { readonly portableOnly: boolean; readonly failures: string[] },
): Promise<void> {
  for (const [component, minimum] of Object.entries(minimums)) {
    if (component === "TaskNotes.Windows.AppAdapters" && options.portableOnly) {
      continue;
    }
    const lines = componentLines.get(component);
    const changedComp = [...changed].filter(
      (k) => componentForSource(k.slice(0, k.lastIndexOf(":"))) === component,
    );
    if (changedComp.length === 0) {
      continue;
    }
    const uninstrumented = await findUninstrumentedComponentFiles(
      component,
      changedComp,
      lines,
      options.portableOnly,
    );
    if (uninstrumented.length > 0) {
      options.failures.push(
        `${component} has changed source that the coverage run never instrumented: ${uninstrumented.join(", ")}.`,
      );
      continue;
    }
    const covered =
      lines === undefined
        ? []
        : [...lines.entries()].filter(([k]) => changed.has(k));
    if (covered.length === 0) {
      continue;
    }
    const cov = percent(
      covered.filter(([, r]) => r.hits > 0).length,
      covered.length,
    );
    await Bun.write(
      Bun.stdout,
      `${component}: ${cov.toFixed(1)}% changed executable lines (${String(covered.length)} lines)\n`,
    );
    if (cov + 0.0001 < minimum) {
      options.failures.push(
        `${component} changed-line coverage ${cov.toFixed(1)}% is below ${minimum.toFixed(1)}%.`,
      );
    }
  }
}

async function main(): Promise<void> {
  const portableOnly = Bun.argv.includes("--portable");
  const ciReports = Bun.argv.includes("--ci");
  if (ciReports && !portableOnly) {
    throw new Error("CI coverage reports only cover portable suites.");
  }
  const suites = portableOnly
    ? ["unit", "integration"]
    : ["unit", "integration", "winui"];
  const files = suites.map((s) =>
    ciReports
      ? path.join(
          repositoryRoot,
          ".ci-reports/coverage/raw/tasknotes-windows",
          s,
          "coverage.cobertura.xml",
        )
      : path.join(
          packageRoot,
          "artifacts/test-results",
          s,
          "coverage.cobertura.xml",
        ),
  );
  const componentLines = await collectComponentLines(files, portableOnly);
  const failures: string[] = [];
  const baseline = BaselineSchema.parse(await Bun.file(baselinePath).json());
  const baseRef = Bun.env["TASKNOTES_COVERAGE_BASE"] ?? "origin/main";
  runGit(
    ["rev-parse", "--verify", `${baseRef}^{commit}`],
    `Could not resolve coverage baseline reference ${baseRef}`,
  );
  const baselineRel = "packages/tasknotes-windows/coverage-baseline.json";
  if (
    Bun.spawnSync(["git", "cat-file", "-e", `${baseRef}:${baselineRel}`], {
      cwd: repositoryRoot,
      stdout: "ignore",
      stderr: "ignore",
    }).exitCode === 0
  ) {
    const prev = BaselineSchema.parse(
      JSON.parse(
        runGit(
          ["show", `${baseRef}:${baselineRel}`],
          "Could not read the prior coverage baseline",
        ),
      ),
    );
    requireNondecreasingBaselines(prev, baseline, failures);
  }
  await verifyComponentBaselines(
    portableOnly ? baseline.portableComponents : baseline.components,
    componentLines,
    failures,
  );
  await verifyChangedLines(
    baseline.changedLineMinimums,
    componentLines,
    await collectChangedSet(baseRef),
    { portableOnly, failures },
  );
  if (failures.length > 0) {
    throw new Error(
      `Windows coverage ratchet failed:\n\n${failures.map((f) => `- ${f}`).join("\n")}`,
    );
  }
}

if (import.meta.main) {
  await main();
}
