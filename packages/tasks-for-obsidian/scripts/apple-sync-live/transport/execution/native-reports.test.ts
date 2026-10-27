import { expect, test } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { retainNativeReports } from "./native-reports.ts";

test("failed XCTest retains available tests report despite failed summary and keeps the original failure", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "facet-native-reports-"));
  try {
    const resultBundle = path.join(root, "case.xcresult");
    await mkdir(resultBundle);
    await writeFile(path.join(resultBundle, "Info.plist"), "synthetic-result");
    const original = new Error("XCTest rejected");
    const summary = new Error("summary unavailable");
    const failures: unknown[] = [original];
    const calls: string[] = [];
    const reports = await retainNativeReports({
      resultBundle,
      evidence: root,
      failures,
      command: async (argv) => {
        const name = argv[4];
        if (name === undefined) throw new Error("wrong command");
        calls.push(name);
        if (name === "summary") throw summary;
        return JSON.stringify({ testNodes: [], failedTests: 1 });
      },
    });
    expect(calls).toEqual(["summary", "tests"]);
    expect(failures).toEqual([original, summary]);
    expect(reports["summary"]).toBeUndefined();
    expect(
      JSON.parse(await readFile(path.join(root, "tests.json"), "utf8")),
    ).toEqual(reports["tests"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
