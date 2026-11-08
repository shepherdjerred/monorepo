import { it, expect } from "vitest";
import { verifyRuntimeInputs } from "#src/capture/suite/runtime-sources.ts";

it("refuses unsupported custom suites before running a build or reading Git", async () => {
  await expect(
    verifyRuntimeInputs("/repo", "/repo/captures/custom.ts", () => {
      throw new Error("Git must not be reached");
    }),
  ).rejects.toThrow("Invalid runtime source path");
});

it("refuses staged, unstaged and untracked shared changes rather than dropping them", async () => {
  for (const changed of [
    "packages/config/src/index.ts",
    "packages/unix-socket-daemon/src/index.ts",
  ]) {
    for (const operation of ["diff", "ls-files"]) {
      await expect(
        verifyRuntimeInputs(
          "/repo",
          "/repo/packages/the-storm/tools/captures/custom.ts",
          async (argv) => (argv.includes(operation) ? `${changed}\0` : ""),
        ),
      ).rejects.toThrow(changed);
    }
  }
  await verifyRuntimeInputs(
    "/repo",
    "/repo/packages/the-storm/tools/captures/custom.ts",
    async () =>
      "packages/the-storm/tools/captures/custom.ts\0packages/mc-harness/src/daemon/clients.ts\0packages/ts-mc-docs/public/media/cooking-pot/media.json\0",
  );
});
