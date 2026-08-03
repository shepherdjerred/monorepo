import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const script = path.join(import.meta.dir, "namespace-playwright-reports.ts");

const playwrightReport = `<testsuites id="" name="" tests="1" failures="0" skipped="0" errors="0" time="1.23">
<testsuite name="home.spec.ts" hostname="chromium" tests="1" failures="0" skipped="0" time="1.23" errors="0">
<testcase name="loads correctly" classname="home.spec.ts &#8250; loads correctly" time="1.23">
</testcase>
</testsuite>
</testsuites>
`;

async function run(
  reportsRoot: string,
): Promise<{ exitCode: number; stderr: string }> {
  const child = Bun.spawn(["bun", script, reportsRoot], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stderr] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stderr };
}

async function writeReport(root: string, dir: string): Promise<string> {
  const reportDir = path.join(root, dir);
  await mkdir(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, "playwright.xml");
  await Bun.write(reportPath, playwrightReport);
  return reportPath;
}

describe("namespace-playwright-reports", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "namespace-pw-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("namespaces sjer.red (separateTests) and docs-wiki (workspaces) reports", async () => {
    const sjerReport = await writeReport(root, "sjer.red");
    const wikiReport = await writeReport(root, "shepherdjerred__docs-wiki");

    const { exitCode } = await run(root);
    expect(exitCode).toBe(0);

    expect(await Bun.file(sjerReport).text()).toContain(
      'classname="sjer.red::home.spec.ts',
    );
    expect(await Bun.file(wikiReport).text()).toContain(
      'classname="@shepherdjerred/docs-wiki::home.spec.ts',
    );
  });

  test("is a no-op (exit 0) when no playwright reports exist", async () => {
    const { exitCode } = await run(root);
    expect(exitCode).toBe(0);
  });

  test("fails fast when a report directory maps to no known workspace", async () => {
    await writeReport(root, "not-a-real-workspace");
    const { exitCode, stderr } = await run(root);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("unknown workspace");
  });
});
