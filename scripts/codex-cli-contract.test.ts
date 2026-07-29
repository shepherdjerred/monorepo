import { describe, expect, test } from "bun:test";

const root = `${import.meta.dir}/..`;
const codex = [
  "bun",
  "--no-install",
  "run",
  "--cwd",
  "scripts",
  "release-refiner:codex",
  "--",
];

function runCodex(args: string[]): string {
  const result = Bun.spawnSync([...codex, ...args], {
    cwd: root,
    env: {
      ...Bun.env,
      NO_COLOR: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = new TextDecoder().decode(result.stdout);
  const stderr = new TextDecoder().decode(result.stderr);
  expect(result.exitCode, `Codex command failed:\n${stderr}`).toBe(0);
  return stdout;
}

describe("release-refiner Codex CLI contract", () => {
  test("runs the pinned Codex version", () => {
    expect(runCodex(["--version"]).trim()).toBe("codex-cli 0.146.0");
  });

  test("retains every noninteractive option used by the release refiner", () => {
    const help = runCodex(["exec", "--help"]);
    for (const option of [
      "--config",
      "--disable",
      "--model",
      "--dangerously-bypass-approvals-and-sandbox",
      "--cd",
      "--skip-git-repo-check",
      "--ephemeral",
      "--ignore-user-config",
      "--ignore-rules",
      "--color",
    ]) {
      expect(help).toContain(option);
    }
  });

  test("retains the stable feature switches disabled by the release refiner", () => {
    const features = runCodex(["features", "list"]);
    for (const feature of ["apps", "plugins", "multi_agent"]) {
      expect(features).toMatch(
        new RegExp(String.raw`^${feature}\s+stable\s+(?:true|false)$`, "m"),
      );
    }
  });

  test("parses the complete release-refiner execution surface without network access", () => {
    const help = runCodex([
      "exec",
      "--dangerously-bypass-approvals-and-sandbox",
      "--ignore-user-config",
      "--ignore-rules",
      "--disable",
      "apps",
      "--disable",
      "plugins",
      "--disable",
      "multi_agent",
      "--ephemeral",
      "--skip-git-repo-check",
      "--color",
      "never",
      "--cd",
      root,
      "--model",
      "gpt-5.6-sol",
      "--config",
      'model_reasoning_effort="medium"',
      "--help",
    ]);
    expect(help).toContain("Run Codex non-interactively");
  });
});
