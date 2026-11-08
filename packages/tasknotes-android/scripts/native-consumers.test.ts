import { expect, test } from "vitest";
import { resolve } from "node:path";
import { boundedCommand } from "./bounded-command";

async function graph(...tasks: string[]): Promise<string> {
  const result = await boundedCommand(
    ["gradle", "--console=plain", "--max-workers=2", "--dry-run", ...tasks],
    {
      cwd: resolve(import.meta.dir, ".."),
      logs: resolve(import.meta.dir, "../build/native-consumer-graphs"),
      // Retire and await the owned client before the unchanged 60-second test budget.
      timeoutMS: 55_000,
    },
  );
  return result.stdout.toString("utf8");
}
test.each([
  ":bindings:mergeDebugJniLibFolders",
  ":bindings:bundleReleaseAar",
  ":app:assembleDebug",
  ":app:packageDebugAndroidTest",
  ":app:installDebug",
  ":app:connectedDebugAndroidTest",
  ":host:assembleDebugAndroidTest",
])(
  "native consumer requires the live artifact guard: %s",
  async (task) => {
    const output = await graph(task);
    const guard = output.indexOf(":verifyNativeArtifacts SKIPPED");
    expect(guard).toBeGreaterThanOrEqual(0);
    expect(guard).toBeLessThan(output.indexOf(`${task} SKIPPED`));
  },
  60_000,
);
test("pure JVM, Kotlin and lint task graphs stay independent of retained JNI", async () => {
  const output = await graph(
    ":host:testDebugUnitTest",
    ":app:testDebugUnitTest",
    ":host:compileDebugKotlin",
    ":app:compileDebugKotlin",
    ":host:compileDebugAndroidTestKotlin",
    ":app:compileDebugAndroidTestKotlin",
    ":host:lintDebug",
    ":app:lintDebug",
  );
  expect(output).not.toContain(":verifyNativeArtifacts SKIPPED");
}, 60_000);
