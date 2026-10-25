import { expect, test } from "vitest";
import { resolve } from "node:path";

async function graph(...tasks: string[]): Promise<string> {
  const child = Bun.spawn(
    ["gradle", "--console=plain", "--max-workers=2", "--dry-run", ...tasks],
    { cwd: resolve(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exit !== 0)
    throw new Error(`Gradle task-graph verification failed: ${stderr}`);
  return stdout;
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
