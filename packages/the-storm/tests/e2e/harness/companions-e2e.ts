import path from "node:path";

/**
 * Stages the test-only Citizens survival harness and the marker that tells it
 * the world is disposable.
 */
export async function stageCompanionsE2e(
  pluginsDir: string,
  jar: string,
): Promise<void> {
  await Bun.write(
    path.join(pluginsDir, "TheStormCompanionsE2E", "fixture.txt"),
    "Disposable Citizens survival acceptance world\n",
  );
  await Bun.write(
    path.join(pluginsDir, "TheStormCompanionsE2E.jar"),
    Bun.file(jar),
  );
}
