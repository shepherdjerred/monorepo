import { expect, test } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { guestBootstrap } from "./bootstrap-code.ts";
import { contentSHA } from "../fields.ts";

test("actual bootstrap verifies each separate sidecar before importing either closed entrypoint", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "facet-bootstrap-binding-"),
  );
  try {
    const names = [
      "live-guest.js",
      "live-config.json",
      "artifact.json",
      "payload.json",
    ];
    const source =
      'console.log("entered-module");export async function bootstrapGuestLiveRun(config){console.log(config)};export const runGuestTransport=bootstrapGuestLiveRun;';
    const values = [
      source,
      '{"config":true}',
      '{"artifact":true}',
      '{"payload":true}',
    ];
    for (const [index, name] of names.entries())
      await writeFile(path.join(directory, name), values[index] ?? "", {
        flag: "wx",
        mode: 0o600,
      });
    const pins = values.map((value) =>
      contentSHA(new TextEncoder().encode(value)),
    );
    for (const entry of [
      "bootstrapGuestLiveRun",
      "runGuestTransport",
    ] as const) {
      const invoke = async () => {
        const child = Bun.spawn(
          [
            process.execPath,
            "-e",
            guestBootstrap(entry),
            path.join(directory, "live-guest.js"),
            ...pins,
          ],
          {
            env: { PATH: "/usr/bin:/bin" },
            stdout: "pipe",
            stderr: "pipe",
            stdin: "ignore",
          },
        );
        return {
          exit: await child.exited,
          stdout: await new Response(child.stdout).text(),
          stderr: await new Response(child.stderr).text(),
        };
      };
      const correct = await invoke();
      expect(correct.exit).toBe(0);
      expect(correct.stderr).toBe("");
      const expectedConfig = pins[1];
      assert.ok(expectedConfig);
      expect(correct.stdout).toBe(`entered-module\n${expectedConfig}\n`);
      for (const [index, name] of names.entries()) {
        await writeFile(path.join(directory, name), "tampered");
        const rejected = await invoke();
        expect(rejected.exit).not.toBe(0);
        expect(rejected.stdout).toBe("");
        await writeFile(path.join(directory, name), values[index] ?? "");
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
