import path from "node:path";
import { describe, expect, test } from "vitest";
import { defaultOut, renderFilesList, renderRwfList } from "#lib/mc/files.ts";

const entry = path.resolve(import.meta.dirname, "../../src/index.ts");

async function run(args: string[]) {
  const child = Bun.spawn(
    [process.execPath, "run", entry, "mc", "files", ...args],
    {
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...Bun.env,
        HOME: "/nonexistent-toolkit-mc-test",
        TOOLKIT_MC_NO_AUTOSTART: "1",
      },
    },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe("toolkit mc files", () => {
  test.each([
    [["get", "/etc/passwd"], "drop the leading slash"],
    [["get", "logs/../ops.json", "--target", "live"], 'may not contain ".."'],
    [
      ["ls", "plugins/LuckPerms", "--target", "live"],
      "outside the readable roots",
    ],
    [["ls"], "<path> is required"],
    [["cat", "logs"], 'unknown files action "cat"'],
    [["rwf", "get", "--target", "sbx-1"], "<match-id> is required"],
    [
      ["rwf", "get", "abc", "--kind", "replay", "--target", "sbx-1"],
      "--kind must be recording or trace",
    ],
  ])("rejects %j before contacting the daemon", async (args, message) => {
    const { stderr, exitCode } = await run(args);
    expect(exitCode).toBe(1);
    expect(stderr).toContain(message);
  });

  test("prints its usage lines", async () => {
    const { stdout, exitCode } = await run(["--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("toolkit mc files rwf get <match-id>");
  });

  test("defaults --out to the file name, minus .gz when gunzipping", () => {
    expect(defaultOut("logs/latest.log", undefined, false)).toBe(
      path.resolve("latest.log"),
    );
    expect(defaultOut("logs/2026-10-03-1.log.gz", undefined, true)).toBe(
      path.resolve("2026-10-03-1.log"),
    );
    expect(defaultOut("logs/latest.log", "out/x.log", false)).toBe(
      path.resolve("out/x.log"),
    );
  });

  test("renders listings", () => {
    expect(
      renderFilesList({
        target: "live",
        path: "plugins/TheStorm",
        entries: [
          {
            name: "rwf-recordings",
            type: "dir",
            size: 4096,
            mtime: "2026-10-04T00:00:00.000Z",
          },
          {
            name: "storm.db",
            type: "file",
            size: 300,
            mtime: "2026-10-04T00:00:00.000Z",
          },
        ],
      }),
    ).toBe(
      [
        "live:/data/plugins/TheStorm",
        "  d    4.0 KiB  2026-10-04T00:00:00.000Z  rwf-recordings/",
        "  -      300 B  2026-10-04T00:00:00.000Z  storm.db",
      ].join("\n"),
    );
    expect(renderRwfList({ target: "sbx-1", artifacts: [] })).toBe(
      "No rwf recordings or bot traces on sbx-1",
    );
  });
});
