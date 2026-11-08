import { mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import {
  assertOfficialPluginAssets,
  assertSealedOfficialPlugin,
  inspectOfficialPlugin,
  officialPluginAssets,
  officialPluginRelease,
} from "./official-plugin";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true });
});
test("the official plugin pins every release asset independently of its version string", () => {
  expect(() => assertOfficialPluginAssets(officialPluginAssets)).not.toThrow();
  for (const filename of ["main.js", "styles.css"] as const) {
    const changed = {
      ...officialPluginAssets,
      [filename]: { ...officialPluginAssets[filename], sha256: "0".repeat(64) },
    };
    expect(() => assertOfficialPluginAssets(changed)).toThrow(
      `asset changed: ${filename}`,
    );
    const changedSize = {
      ...officialPluginAssets,
      [filename]: {
        ...officialPluginAssets[filename],
        size: officialPluginAssets[filename].size + 1,
      },
    };
    expect(() => assertOfficialPluginAssets(changedSize)).toThrow(
      `asset changed: ${filename}`,
    );
  }
});
test("sealed evidence rejects omitted assets and provenance from another release", () => {
  const current = {
    release: officialPluginRelease,
    id: "tasknotes" as const,
    assets: officialPluginAssets,
  };
  expect(() => assertSealedOfficialPlugin(current, current)).not.toThrow();
  expect(() =>
    assertOfficialPluginAssets({
      "manifest.json": officialPluginAssets["manifest.json"],
    }),
  ).toThrow();
  expect(() =>
    assertSealedOfficialPlugin(
      { ...current, release: { ...officialPluginRelease, version: "4.13.7" } },
      current,
    ),
  ).toThrow();
  expect(() =>
    assertSealedOfficialPlugin(
      {
        ...current,
        assets: {
          ...officialPluginAssets,
          "main.js": { size: 4_544_257, sha256: "0".repeat(64) },
        },
      },
      current,
    ),
  ).toThrow("main.js");
});
test("asset inspection rejects symlinked files and missing installed assets", async () => {
  const directory = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "facet-official-plugin-")),
  );
  directories.push(directory);
  await expect(inspectOfficialPlugin(directory)).rejects.toThrow();
  const target = path.join(directory, "outside.js");
  await writeFile(target, "synthetic");
  await symlink(target, path.join(directory, "main.js"));
  await expect(inspectOfficialPlugin(directory)).rejects.toThrow(
    "Unsafe official plugin asset",
  );
});
