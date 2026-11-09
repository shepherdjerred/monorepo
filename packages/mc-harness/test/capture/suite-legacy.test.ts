import { it, expect } from "vitest";
import { mkdtemp, mkdir, readdir, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { publishLegacy } from "#src/capture/suite/legacy.ts";
import { docsCoverage } from "#src/capture/suite/docs-coverage.ts";
import {
  LegacyOutputSchema,
  type CaptureSuite,
} from "#src/capture/suite/define.ts";

async function fixture(root: string) {
  await mkdir(path.join(root, "media/example"), { recursive: true });
  await Bun.write(
    path.join(root, "media/example/media.json"),
    JSON.stringify({
      schema: 1,
      name: "example",
      kind: "image",
      width: 1280,
      height: 720,
      src: "/media/example/original.webp",
      poster: "/media/example/poster.webp",
      alt: "Example",
      caption: "Example",
      annotations: [],
    }),
  );
  await Bun.write(
    path.join(root, "media/example/original.webp"),
    "verified derivative",
  );
}
const output = { shot: "example", path: "/screenshots/old-example.webp" };

it("updates selected legacy URLs, retaining the old bytes privately", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "capture-alias-"));
  try {
    await fixture(root);
    const target = path.join(root, output.path.slice(1)),
      backup = path.join(root, "backups");
    await mkdir(path.dirname(target));
    await Bun.write(target, "previous");
    await publishLegacy([output], [], root, backup);
    expect(await Bun.file(target).text()).toBe("previous");
    await publishLegacy([output], ["example"], root, backup);
    expect(await Bun.file(target).text()).toBe("verified derivative");
    const files = await readdir(backup);
    expect(files).toHaveLength(1);
    expect(
      await Bun.file(path.join(backup, files[0] ?? "missing")).text(),
    ).toBe("previous");
    await publishLegacy([output], ["example"], root, backup);
    expect(await Bun.file(target).text()).toBe("verified derivative");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("refuses type mismatches, traversal, and linked legacy directories", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "capture-alias-"));
  try {
    await fixture(root);
    for (const target of [
      "/screenshots/../escape.webp",
      "/media/example/original.webp",
      "/demos/other.webm",
    ])
      expect(
        LegacyOutputSchema.safeParse({ shot: "example", path: target }).success,
      ).toBe(false);
    await expect(
      publishLegacy(
        [{ shot: "example", path: "/demos/example.mp4" }],
        ["example"],
        root,
        path.join(root, "backup"),
      ),
    ).rejects.toThrow("type differs");
    await mkdir(path.join(root, "outside"));
    await symlink(path.join(root, "outside"), path.join(root, "screenshots"));
    await expect(
      publishLegacy([output], ["example"], root, path.join(root, "backup")),
    ).rejects.toThrow("Linked");
    expect(await readdir(path.join(root, "outside"))).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("counts unembedded legacy assets and reports missing canonical and legacy producers", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "capture-coverage-"));
  try {
    await fixture(root);
    await mkdir(path.join(root, "screenshots"));
    await Bun.write(path.join(root, output.path.slice(1)), "old");
    const suite: CaptureSuite = {
      id: "test",
      bootstrap: [0, 64, 0],
      patches: [],
      scenarios: [],
    };
    expect(await docsCoverage(suite, root)).toEqual({
      media: 1,
      legacy: 1,
      missing: ["/media/example/media.json", output.path],
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
