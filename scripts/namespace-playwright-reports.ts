// Namespace every Playwright JUnit report in place so its testsuite/name and
// testcase/classname carry the `<workspace>::` prefix that run-ci-test.ts adds
// to every manifest-driven report. The Playwright lanes emit their JUnit report
// directly via Playwright's junit reporter (sjer.red and docs-wiki are separate
// e2e tasks, not manifest steps), so without this step those reports upload to
// the same Test Engine suite as the namespaced package reports but WITHOUT a
// prefix — letting a Playwright test collide with a similarly named test from
// another workspace (e.g. sjer.red vs docs-wiki, both raw).
//
// The report basename `playwright.xml` is unique to the Playwright lanes (no
// manifest step is named "playwright"), so globbing it never double-namespaces
// an already-prefixed manifest report. The manifest maps each report directory
// back to its package name for the prefix; an unknown directory fails fast.
import path from "node:path";
import { Glob } from "bun";
import {
  namespaceJUnit,
  sanitizeWorkspace,
  TestManifestSchema,
} from "./ci-reporting.ts";

const reportsRoot =
  process.argv[2] ?? path.join(process.cwd(), ".ci-reports", "junit");

const manifest = TestManifestSchema.parse(
  await Bun.file(path.join(import.meta.dir, "ci-test-manifest.json")).json(),
);
const packagesByReportDirectory = new Map(
  [...manifest.workspaces, ...manifest.separateTests].map((entry) => [
    sanitizeWorkspace(entry.package),
    entry.package,
  ]),
);

let namespaced = 0;
for await (const relative of new Glob("**/playwright.xml").scan(reportsRoot)) {
  const reportDirectory = relative.split(/[\\/]/)[0];
  const workspace =
    reportDirectory === undefined
      ? undefined
      : packagesByReportDirectory.get(reportDirectory);
  if (workspace === undefined) {
    throw new Error(
      `Playwright report belongs to an unknown workspace: ${relative}`,
    );
  }
  const reportPath = path.join(reportsRoot, relative);
  await Bun.write(
    reportPath,
    namespaceJUnit(await Bun.file(reportPath).text(), workspace),
  );
  console.log(`namespaced ${relative} with ${workspace}::`);
  namespaced += 1;
}
console.log(`namespaced ${namespaced.toString()} playwright report(s)`);
