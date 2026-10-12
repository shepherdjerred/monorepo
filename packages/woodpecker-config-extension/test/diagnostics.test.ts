import { expect, test } from "vitest";
import { diagnosticCommands } from "#src/pipeline/diagnostics.ts";
import { credentiallessHostedAutomationSteps } from "#src/pipeline/steps.ts";
import { TEST_IMAGES, testPipelineSteps } from "./identity.ts";

test("diagnostic wrapper preserves shell arguments after toolchain bootstrap", async () => {
  const commands = diagnosticCommands("verify", [
    "bootstrap",
    "printf '%s' \"a'b\"",
    "exit 42",
  ]);
  expect(commands[0]).toBe("bootstrap");
  // Replace just the wrapper executable with a shell function that executes its
  // command arguments; exercise the emitted quoting with the real shell.
  const shell = `bun() { shift 4; "$@"; }; ${commands[1] ?? "exit 1"}`;
  const child = Bun.spawn(["bash", "-c", shell], {
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(await new Response(child.stdout).text()).toBe("a'b");
  expect(await child.exited).toBe(42);
});

test("only credentialed verification and browser lanes publish task diagnostics", () => {
  for (const key of ["verify", "playwright-e2e"]) {
    const step = testPipelineSteps().find((candidate) => candidate.key === key);
    expect(step?.commands.join("\n")).toContain(
      `run-with-diagnostics.ts ${key} --`,
    );
    expect(
      step?.secrets?.some(
        (grant) => grant.env === "SEAWEEDFS_HANDOFF_ACCESS_KEY_ID",
      ),
    ).toBe(true);
  }
  for (const step of credentiallessHostedAutomationSteps(TEST_IMAGES)) {
    expect(step.commands.join("\n")).not.toContain("run-with-diagnostics");
    expect(step.secrets ?? []).toHaveLength(0);
  }
});
