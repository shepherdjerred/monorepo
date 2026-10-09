import { cp, mkdir, readdir } from "node:fs/promises";
import path from "node:path";

async function digest(file: string) {
  return new Bun.CryptoHasher("sha256")
    .update(await Bun.file(file).arrayBuffer())
    .digest("hex");
}

/** Freeze built producers so development cannot change a running conversion batch. */
export async function freezeInputs(root: string, output: string) {
  const producer = path.join(output, "producer");
  await mkdir(producer, { mode: 0o700 });
  const stormJar = path.join(producer, "TheStorm.jar");
  const fixturesJar = path.join(producer, "TheStormFixtures.jar");
  const content = path.join(producer, "plugins/TheStorm");
  const mapTool = path.join(producer, "rwfmap");
  await Promise.all([
    cp(path.join(root, "plugin/dist/build/libs/TheStorm.jar"), stormJar),
    cp(
      path.join(root, "plugin/dist/build/libs/TheStormFixtures.jar"),
      fixturesJar,
    ),
    cp(path.join(root, "server/owned/plugins/TheStorm"), content, {
      recursive: true,
    }),
    cp(
      path.join(root, "server/owned/plugins/Citizens"),
      path.join(producer, "plugins/Citizens"),
      { recursive: true },
    ),
    cp(path.join(root, "plugin/tools/rwfmap/build/install/rwfmap"), mapTool, {
      recursive: true,
    }),
    cp(
      path.join(root, "tools/maps"),
      path.join(producer, "sources/tools/maps"),
      { recursive: true },
    ),
    cp(
      path.join(root, "tools/learning/maps"),
      path.join(producer, "sources/tools/learning/maps"),
      { recursive: true },
    ),
    ...["rwf-map-scenario.json", "rwf-map-scenarios.json"].map((file) =>
      cp(
        path.join(root, "plugin/modules/rwfbots/src/main/resources", file),
        path.join(producer, file),
      ),
    ),
    cp(
      path.join(root, "tests/e2e/harness"),
      path.join(producer, "sources/tests/e2e/harness"),
      { recursive: true },
    ),
  ]);
  const listing = await readdir(producer, {
    recursive: true,
    withFileTypes: true,
  });
  const files = listing
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort();
  const hashes = await Promise.all(
    files.map(async (file) => ({
      file: path.relative(producer, file),
      sha256: await digest(file),
    })),
  );
  const check = async () => {
    for (const entry of hashes) {
      if ((await digest(path.join(producer, entry.file))) !== entry.sha256)
        throw new Error(
          `Frozen map conversion producer changed: ${entry.file}`,
        );
    }
  };
  await Bun.write(
    path.join(output, "producer.json"),
    JSON.stringify({ schema: 1, hashes }, null, 2) + "\n",
  );
  return { stormJar, fixturesJar, content, mapTool, hashes, check };
}
export type ConversionInputs = Awaited<ReturnType<typeof freezeInputs>>;
