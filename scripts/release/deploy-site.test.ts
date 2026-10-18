import { expect, test } from "vitest";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

async function runSiteCommand(script: string, args: string[]) {
  const directory = await mkdtemp(path.join(tmpdir(), "site-build-contract-"));
  try {
    const aws = path.join(directory, "aws");
    await Bun.write(
      aws,
      "#!/bin/sh\necho 'unexpected remote AWS call' >&2\nexit 91\n",
    );
    await chmod(aws, 0o755);
    const child = Bun.spawn([process.execPath, script, ...args], {
      cwd: new URL("../..", import.meta.url).pathname,
      env: { PATH: `${directory}:${Bun.env["PATH"] ?? ""}` },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, status] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { stdout, stderr, status };
  } finally {
    await rm(directory, { recursive: true });
  }
}
test.each(["ts-mc", "sjer.red"])(
  "%s publication rehearsal never invokes activation or needs credentials",
  async (site) => {
    const result = await runSiteCommand("scripts/release/deploy-site.ts", [
      site,
      "--archive",
      "--dry-run",
    ]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("activation belongs to Delivery");
    expect(result.stdout).not.toContain("+++ sync:");
    expect(result.stdout).not.toContain("purge");
  },
);
test("credential-free validation selects the same reviewed source and rejects unknown targets", async () => {
  const valid = await runSiteCommand("scripts/release/check-site-build.ts", [
    "ts-mc",
  ]);
  expect(valid.status, valid.stderr).toBe(0);
  expect(valid.stdout).toContain("ts-mc-docs");
  const invalid = await runSiteCommand("scripts/release/check-site-build.ts", [
    "unknown-target",
  ]);
  expect(invalid.status).not.toBe(0);
  expect(invalid.stderr).toContain("Unknown site");
});
