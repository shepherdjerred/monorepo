import { describe, expect, test } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { command } from "./platform";

describe("bounded acceptance subprocesses", () => {
  test("streams stdout and stderr to distinct private evidence files", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "facet-command-"));
    try {
      const stdout = path.join(directory, "stdout.log");
      const stderr = path.join(directory, "stderr.log");
      await command(
        [
          process.execPath,
          "-e",
          'process.stdout.write("out");process.stderr.write("err")',
        ],
        undefined,
        {},
        { logFile: stdout, stderrLogFile: stderr },
      );
      expect(await readFile(stdout, "utf8")).toBe("out");
      expect(await readFile(stderr, "utf8")).toBe("err");
    } finally {
      await rm(directory, { recursive: true });
    }
  });
  test("collects a successful structured response", async () => {
    await expect(
      command([process.execPath, "-e", 'process.stdout.write("owned")']),
    ).resolves.toBe("owned");
  });
  test("kills a stalled command and its inherited-output descendants at the deadline", async () => {
    const program =
      'Bun.spawn([process.execPath,"-e","setInterval(()=>{},1000)"],{stdout:"inherit",stderr:"inherit"});setInterval(()=>{},1000)';
    const began = Date.now();
    await expect(
      command(
        [process.execPath, "-e", program],
        undefined,
        {},
        { timeoutMS: 200 },
      ),
    ).rejects.toThrow("deadline");
    expect(Date.now() - began).toBeLessThan(2000);
  });
  test("rejects invalid bounds before starting a child", async () => {
    await expect(
      command([process.execPath, "-e", ""], undefined, {}, { timeoutMS: 0 }),
    ).rejects.toThrow();
  });
});
