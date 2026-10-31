import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";

/** Retain each available report even when XCTest or its sibling report failed. */
export async function retainNativeReports(options: {
  resultBundle: string;
  evidence: string;
  command: (argv: string[], capture: boolean) => Promise<string>;
  failures: unknown[];
}): Promise<Record<string, unknown>> {
  const { resultBundle, evidence, command, failures } = options;
  assert.equal(
    await Bun.file(path.join(resultBundle, "Info.plist")).exists(),
    true,
    "Native result bundle was not produced",
  );
  const reports: Record<string, unknown> = {};
  for (const name of ["summary", "tests"] as const) {
    try {
      const raw: unknown = JSON.parse(
        await command(
          [
            "xcrun",
            "xcresulttool",
            "get",
            "test-results",
            name,
            "--compact",
            "--path",
            resultBundle,
          ],
          true,
        ),
      );
      await writeFile(
        path.join(evidence, `${name}.json`),
        JSON.stringify(raw),
        { flag: "wx", mode: 0o600 },
      );
      reports[name] = raw;
    } catch (error) {
      failures.push(error);
    }
  }
  return reports;
}
