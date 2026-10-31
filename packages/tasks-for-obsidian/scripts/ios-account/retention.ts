import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { privateAccountSelector } from "./runtime";

export const InputLogAvailabilitySchema = z.strictObject({
  hasCoverage: z.boolean(),
  hasDiagnostics: z.literal(true),
  hasTestResults: z.literal(true),
  logs: z
    .array(z.enum(["action", "build", "console"]))
    .min(1)
    .max(3)
    .refine(
      (logs) => logs.includes("action") && new Set(logs).size === logs.length,
    ),
});
type Command = (argv: string[], capture?: boolean) => Promise<string>;

/** Decode every SDK-declared log and diagnostics; an absent console is measured. */
export async function retainPrivateInputLogs(
  result: string,
  evidence: string,
  command: Command,
) {
  const invoke = (args: string[]) =>
    command(["xcrun", "xcresulttool", ...args], true);
  const store = async (name: string, value: string) => {
    JSON.parse(value);
    await writeFile(path.join(evidence, name), value, {
      flag: "wx",
      mode: 0o600,
    });
  };
  const logs = async () => {
    const raw = await invoke([
      "get",
      "content-availability",
      "--path",
      result,
      "--compact",
    ]);
    const availability = InputLogAvailabilitySchema.parse(JSON.parse(raw));
    await store("content-availability.json", raw);
    for (const kind of availability.logs) {
      await store(
        `${kind}.json`,
        await invoke([
          "get",
          "log",
          "--path",
          result,
          "--type",
          kind,
          "--compact",
        ]),
      );
    }
    return availability;
  };
  const activities = async () => {
    await store(
      "activities.json",
      await invoke([
        "get",
        "test-results",
        "activities",
        "--path",
        result,
        "--test-id",
        privateAccountSelector + "()",
        "--compact",
      ]),
    );
  };
  const diagnostics = async () => {
    const directory = path.join(evidence, "diagnostics");
    await invoke([
      "export",
      "diagnostics",
      "--path",
      result,
      "--output-path",
      directory,
    ]);
    const files = [
      ...new Bun.Glob("**/*").scanSync({
        cwd: directory,
        onlyFiles: true,
        dot: true,
      }),
    ];
    assert.ok(files.length > 0 && files.length <= 1000);
    assert.ok(
      files.every((file) => /\.(?:log|txt|json|crash|ips|plist)$/u.test(file)),
      "Private input diagnostics contain an unsupported payload",
    );
    assert.ok(
      files.some((file) =>
        /^StandardOutputAndStandardError.*\.txt$/u.test(path.basename(file)),
      ),
      "Private input diagnostics lack decoded stdout/stderr",
    );
  };
  const retained = await Promise.allSettled([
    logs(),
    activities(),
    diagnostics(),
  ]);
  if (retained.some((outcome) => outcome.status === "rejected"))
    throw new Error("Private iOS input log retention is incomplete");
  const logResult = retained[0];
  assert.equal(logResult.status, "fulfilled");
  return {
    availability: logResult.value,
    consoleLog: logResult.value.logs.includes("console")
      ? ("decoded" as const)
      : ("confirmed-absent" as const),
    decodedActivities: true as const,
    exportedDiagnostics: true as const,
  };
}
