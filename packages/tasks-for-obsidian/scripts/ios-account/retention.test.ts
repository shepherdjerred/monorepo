import {
  mkdtemp,
  realpath,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { retainPrivateInputLogs } from "./retention";
import { scanPrivateInputEvidence } from "./leak-check";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true });
});
async function fixture(
  logs: string[],
  diagnostic = "safe",
  rejected = "never",
) {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "facet-input-retention-")),
  );
  roots.push(root);
  const calls: string[][] = [];
  const command = async (argv: string[]) => {
    calls.push(argv);
    if (argv.includes("content-availability"))
      return JSON.stringify({
        hasCoverage: false,
        hasDiagnostics: true,
        hasTestResults: true,
        logs,
      });
    if (argv.includes("diagnostics")) {
      const directory = path.join(root, "diagnostics");
      await mkdir(directory);
      await writeFile(
        path.join(directory, "StandardOutputAndStandardError.txt"),
        diagnostic,
      );
      return "";
    }
    if (argv.includes("log") && argv.includes(rejected))
      throw new Error("Declared log is unreadable");
    return JSON.stringify({ entries: [] });
  };
  return { root, calls, command };
}

test("SDK-declared absent console is recorded; action, activities and real stdout remain retained", async () => {
  const f = await fixture(["action"]);
  const result = await retainPrivateInputLogs(
    "owned.xcresult",
    f.root,
    f.command,
  );
  expect(result.consoleLog).toBe("confirmed-absent");
  expect(result.availability.logs).toEqual(["action"]);
  expect(f.calls.some((argv) => argv.includes("console"))).toBe(false);
  expect(
    JSON.parse(await readFile(path.join(f.root, "activities.json"), "utf8")),
  ).toEqual({ entries: [] });
  expect(
    await readFile(
      path.join(f.root, "diagnostics/StandardOutputAndStandardError.txt"),
      "utf8",
    ),
  ).toBe("safe");
});

test("declared console must decode and a failed extraction does not suppress independent evidence", async () => {
  const f = await fixture(["action", "console"]);
  const retained = await retainPrivateInputLogs(
    "owned.xcresult",
    f.root,
    f.command,
  );
  expect(retained.consoleLog).toBe("decoded");
  const failed = await fixture(["action", "console"], "safe", "console");
  await expect(
    retainPrivateInputLogs("owned.xcresult", failed.root, failed.command),
  ).rejects.toThrow("incomplete");
  expect(
    await Bun.file(path.join(failed.root, "activities.json")).exists(),
  ).toBe(true);
  expect(
    await Bun.file(
      path.join(failed.root, "diagnostics/StandardOutputAndStandardError.txt"),
    ).exists(),
  ).toBe(true);
});

test.each([
  { logs: [] },
  { logs: ["future-log"] },
  { logs: ["action", "action"] },
])("unsupported availability %j fails closed", async ({ logs }) => {
  const f = await fixture(logs);
  await expect(
    retainPrivateInputLogs("owned.xcresult", f.root, f.command),
  ).rejects.toThrow("incomplete");
  expect(await Bun.file(path.join(f.root, "activities.json")).exists()).toBe(
    true,
  );
});

test.each([
  "synthetic-email-needle@example.invalid",
  "synthetic-password-needle-q7!",
])(
  "decoded diagnostic sentinel is scanned without exposing its value",
  async (needle) => {
    const f = await fixture(["action"], needle);
    await retainPrivateInputLogs("owned.xcresult", f.root, f.command);
    await expect(scanPrivateInputEvidence(f.root, [needle])).rejects.toThrow(
      "sentinel appeared",
    );
  },
);
