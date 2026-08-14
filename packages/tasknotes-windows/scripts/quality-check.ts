import path from "node:path";
import { z } from "zod";

const packageRoot = path.resolve(import.meta.dir, "..");
const ProjectManifestSchema = z.object({
  schemaVersion: z.literal(1),
  projects: z.array(
    z.object({
      path: z.string().endsWith(".csproj"),
      classification: z.enum([
        "portable-generated",
        "portable",
        "portable-test",
        "windows-only",
        "windows-only-test",
      ]),
    }),
  ),
});
const violations: string[] = [];
const normalize = (value: string): string => value.replaceAll("\\", "/");
const forbidden = [
  { pattern: /#pragma\s+warning\s+disable/u, message: "warning suppression" },
  { pattern: /SuppressMessage/u, message: "analyzer suppression" },
  { pattern: /<NoWarn>/u, message: "project warning suppression" },
  { pattern: /\[(?:TestMethod\([^)]*\),\s*)?Ignore/u, message: "ignored test" },
  { pattern: /Assert\.Inconclusive/u, message: "inconclusive test" },
  {
    pattern: /Assert\.IsTrue\(true[,)\s]/u,
    message: "placeholder assertion",
  },
  { pattern: /async\s+void/u, message: "async-void method" },
  { pattern: /catch[^\r\n{]*\{\}/u, message: "empty catch" },
];

const sources = await Array.fromAsync(
  new Bun.Glob("{src,tests}/**/*.{cs,csproj}").scan({
    cwd: packageRoot,
    onlyFiles: true,
  }),
);
for (const source of sources) {
  const normalizedSource = normalize(source);
  if (
    normalizedSource.includes("/bin/") ||
    normalizedSource.includes("/obj/")
  ) {
    continue;
  }
  const text = await Bun.file(path.join(packageRoot, source)).text();
  for (const rule of forbidden) {
    if (
      rule.message === "async-void method" &&
      text.includes("protected override async void OnLaunched")
    ) {
      continue;
    }
    if (rule.pattern.test(text)) {
      violations.push(`${source}: ${rule.message}`);
    }
  }
}

async function requireAbsent(
  project: string,
  pattern: RegExp,
  description: string,
): Promise<void> {
  const files = await Array.fromAsync(
    new Bun.Glob("**/*.cs").scan({
      cwd: path.join(packageRoot, project),
      onlyFiles: true,
    }),
  );
  for (const file of files) {
    const normalizedFile = normalize(file);
    if (normalizedFile.includes("/bin/") || normalizedFile.includes("/obj/")) {
      continue;
    }
    const relative = `${project}/${file}`;
    if (pattern.test(await Bun.file(path.join(packageRoot, relative)).text())) {
      violations.push(`${relative}: ${description}`);
    }
  }
}

await requireAbsent(
  "src/TaskNotes.Windows.Host",
  /Microsoft\.UI|Windows\.UI|DispatcherQueue|SynchronizationContext|CoreDispatcher/u,
  "Host must remain UI-framework independent",
);
await requireAbsent(
  "src/TaskNotes.Windows.Presentation",
  /Microsoft\.UI|Windows\.UI/u,
  "Presentation must remain portable",
);
await requireAbsent(
  "src/TaskNotes.Windows.Presentation",
  /\buniffi\./u,
  "Presentation must not reference generated bindings",
);
await requireAbsent(
  "src/TaskNotes.Windows.App",
  /\buniffi\./u,
  "App must call the core through Host contracts",
);
async function requireProjectReferences(
  project: string,
  expected: readonly string[],
): Promise<void> {
  const projectPath = path.join(packageRoot, project);
  const document = await Bun.file(projectPath).text();
  const actual = [
    ...document.matchAll(/<ProjectReference\s+Include="([^"]+)"/gu),
  ]
    .map((match) => match[1])
    .filter((value) => value !== undefined)
    .map((value) =>
      normalize(
        path.relative(
          packageRoot,
          path.resolve(path.dirname(projectPath), value),
        ),
      ),
    )
    .sort();
  const required = [...expected].sort();
  if (actual.join("\n") !== required.join("\n")) {
    violations.push(
      `${project}: expected project references [${required.join(", ")}], found [${actual.join(", ")}]`,
    );
  }
}

await requireProjectReferences(
  "src/TaskNotes.Windows.Host/TaskNotes.Windows.Host.csproj",
  ["src/TaskNotes.Core.Bindings/TaskNotes.Core.Bindings.csproj"],
);
await requireProjectReferences(
  "src/TaskNotes.Windows.Presentation/TaskNotes.Windows.Presentation.csproj",
  ["src/TaskNotes.Windows.Host/TaskNotes.Windows.Host.csproj"],
);
await requireProjectReferences(
  "src/TaskNotes.Windows.App/TaskNotes.Windows.App.csproj",
  [
    "src/TaskNotes.Windows.Host/TaskNotes.Windows.Host.csproj",
    "src/TaskNotes.Windows.Presentation/TaskNotes.Windows.Presentation.csproj",
  ],
);

const manifest = ProjectManifestSchema.parse(
  await Bun.file(path.join(packageRoot, "projects.json")).json(),
);
const allSolution = await Bun.file(
  path.join(packageRoot, "TaskNotes.Windows.slnx"),
).text();
const portableSolution = await Bun.file(
  path.join(packageRoot, "TaskNotes.Windows.Portable.slnx"),
).text();
const preparedLanePath = path.join(
  packageRoot,
  "ci",
  "windows-buildkite.pipeline.yml",
);
const preparedLane = await Bun.file(preparedLanePath).text();
const discoveredProjects = await Array.fromAsync(
  new Bun.Glob("{src,tests}/**/*.csproj").scan({
    cwd: packageRoot,
    onlyFiles: true,
  }),
);
const declared = new Set(manifest.projects.map((project) => project.path));
for (const rawProject of discoveredProjects) {
  const project = normalize(rawProject);
  if (!declared.has(project)) {
    violations.push(`${project}: project is missing from projects.json`);
  }
}
for (const project of manifest.projects) {
  if (!(await Bun.file(path.join(packageRoot, project.path)).exists())) {
    violations.push(`${project.path}: declared project does not exist`);
  }
  if (!allSolution.includes(`Path="${project.path}"`)) {
    violations.push(`${project.path}: missing from TaskNotes.Windows.slnx`);
  }
  const portable = project.classification.startsWith("portable");
  if (portable !== portableSolution.includes(`Path="${project.path}"`)) {
    violations.push(
      `${project.path}: portable solution inclusion disagrees with '${project.classification}' classification`,
    );
  }
}
for (const contract of [
  "bun run windows:verify",
  "TASKNOTES_VISUAL_PROFILE",
  "100-light",
  "100-dark",
  "100-high-contrast",
  "200-light",
  "200-dark",
  "200-high-contrast",
  "artifacts/test-results/**/*.junit.xml",
  "artifacts/test-results/**/coverage.cobertura.xml",
  "artifacts/e2e/**/*",
]) {
  if (!preparedLane.includes(contract)) {
    violations.push(
      `ci/windows-buildkite.pipeline.yml: missing prepared-worker contract '${contract}'`,
    );
  }
}

const bindingProject = await Bun.file(
  path.join(
    packageRoot,
    "src",
    "TaskNotes.Core.Bindings",
    "TaskNotes.Core.Bindings.csproj",
  ),
).text();
for (const contract of [
  "<EnableNETAnalyzers>false</EnableNETAnalyzers>",
  "<EnforceCodeStyleInBuild>false</EnforceCodeStyleInBuild>",
  '<Compile Include="../../../tasknotes-core/bindings/csharp/TaskNotesCore.cs"',
]) {
  if (!bindingProject.includes(contract)) {
    violations.push(
      `TaskNotes.Core.Bindings.csproj: missing generated-code isolation contract '${contract}'`,
    );
  }
}

if (violations.length > 0) {
  throw new Error(
    `Windows quality checks failed:\n\n${violations.map((violation) => `- ${violation}`).join("\n")}`,
  );
}
await Bun.write(
  Bun.stdout,
  `TaskNotes Windows quality checks passed: ${String(sources.length)} C# files and ${String(manifest.projects.length)} classified projects.\n`,
);
