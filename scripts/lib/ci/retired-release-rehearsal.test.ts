import { expect, test } from "vitest";

const digest = `sha256:${"a".repeat(64)}`;
const stateData = {
  schema: "scout-release-state/v1",
  buildNumber: 42,
  version: "2.0.0-42",
  sourceCommit: "b".repeat(40),
  backendImageDigest: digest,
  siteArchiveDigest: digest,
  betaSiteArchiveDigest: digest,
  releaseInputDigest: digest,
};
const state = JSON.stringify(stateData);
async function command(script: string, args: string[], event = "pull_request") {
  const child = Bun.spawn([process.execPath, script, ...args], {
    cwd: new URL("../../..", import.meta.url).pathname,
    // No credentials, kubectl, Git, AWS, or provider executable is available.
    env: { PATH: "/nonexistent", CI_PIPELINE_EVENT: event },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exit, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exit, stdout, stderr };
}

test.each(["archive", "deploy-beta", "reconcile-prod", "tag-release"])(
  "old Scout %s rehearsal validates frozen inputs and cannot execute effects",
  async (name) => {
    const script = "scripts/release/scout-site-release.ts";
    const dry = await command(script, [name, "--state", state, "--dry-run"]);
    expect(dry.exit, dry.stderr).toBe(0);
    expect(dry.stdout).toContain("activation belongs to Delivery");
    const real = await command(script, [name, "--state", state]);
    const main = await command(
      script,
      [name, "--state", state, "--dry-run"],
      "push",
    );
    const invalid = await command(script, [name, "--state", "{}", "--dry-run"]);
    const mismatched = await command(script, [
      name,
      "--state",
      JSON.stringify({ ...stateData, version: "2.0.0-43" }),
      "--dry-run",
    ]);
    expect(real.exit).not.toBe(0);
    expect(main.exit).not.toBe(0);
    expect(invalid.exit).not.toBe(0);
    expect(mismatched.exit).not.toBe(0);
  },
);

test("old production pin lookup exposes no Git selection outside the PR rehearsal", async () => {
  const script = "scripts/release/scout-site-release.ts";
  const dry = await command(script, ["resolve-prod-pin"]);
  expect(dry.exit, dry.stderr).toBe(0);
  expect(dry.stdout.trim()).toBe("null");
  const main = await command(script, ["resolve-prod-pin"], "push");
  expect(main.exit).not.toBe(0);
});

test("old empty commit-back rehearsal has no writer or external executable", async () => {
  const script = "scripts/release/update-versions.ts";
  const args = [
    "--commit-back",
    "--candidates",
    JSON.stringify({
      schema: "pin-candidates/v1",
      buildNumber: 42,
      candidates: {},
    }),
  ];
  const dry = await command(script, [...args, "--dry-run"]);
  expect(dry.exit, dry.stderr).toBe(0);
  expect(dry.stdout).toContain("no Git deployment state exists");
  const real = await command(script, args);
  const main = await command(script, [...args, "--dry-run"], "push");
  expect(real.exit).not.toBe(0);
  expect(main.exit).not.toBe(0);
});
