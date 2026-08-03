import path from "node:path";
import {
  reportedWorkspacesForReports,
  TestManifestSchema,
} from "./ci-reporting.ts";

const repositoryRoot = path.resolve(import.meta.dir, "..");
const manifest = TestManifestSchema.parse(
  await Bun.file(path.join(import.meta.dir, "ci-test-manifest.json")).json(),
);
const reportRoot = path.join(repositoryRoot, ".ci-reports");
const junitRoot = path.join(reportRoot, "junit");
const reports: string[] = [];
const declaredWorkspaces = [
  ...manifest.workspaces,
  ...manifest.testlessWorkspaces,
  ...manifest.separateTests,
].map((entry) => entry.package);

await Bun.$`mkdir -p ${junitRoot}`;
for await (const report of new Bun.Glob("**/*.xml").scan({
  cwd: junitRoot,
  onlyFiles: true,
})) {
  reports.push(report);
}
reports.sort();

await Bun.write(
  path.join(reportRoot, "report-index.json"),
  `${JSON.stringify(
    {
      version: 1,
      scope: Bun.env["CI_REPORTING_SCOPE"] ?? "partial",
      reports,
      reportCount: reports.length,
      declaredWorkspaces,
      reportedWorkspaces: reportedWorkspacesForReports(manifest, reports),
      testlessWorkspaces: manifest.testlessWorkspaces,
      separateTests: manifest.separateTests,
    },
    null,
    2,
  )}\n`,
);
