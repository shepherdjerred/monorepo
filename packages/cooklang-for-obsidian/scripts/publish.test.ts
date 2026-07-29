import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  manifestsMatchIgnoringVersion,
  readManifestMetadata,
  updateVersionsJson,
} from "./publish.ts";

test("manifest comparison ignores only the version field", () => {
  const built = {
    id: "cooklang",
    version: "1.0.0",
    minAppVersion: "1.5.0",
    nested: { enabled: true },
  };
  expect(
    manifestsMatchIgnoringVersion(built, { ...built, version: "1.0.1" }),
  ).toBe(true);
  expect(
    manifestsMatchIgnoringVersion(built, {
      ...built,
      version: "1.0.1",
      minAppVersion: "1.6.0",
    }),
  ).toBe(false);
});

test("invalid manifest metadata fails hard", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cooklang-manifest-"));
  const manifest = path.join(dir, "manifest.json");
  try {
    await Bun.write(manifest, '{"version":"1.0.0"}');
    await expect(readManifestMetadata(manifest)).rejects.toThrow(
      "minAppVersion",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("versions update stages the exact nested path", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cooklang-versions-"));
  const nested = "packages/cooklang-for-obsidian/versions.json";
  const versionsPath = path.join(dir, nested);
  try {
    await Bun.$`git -C ${dir} init -b main`.quiet();
    await mkdir(path.dirname(versionsPath), { recursive: true });
    await Bun.write(versionsPath, '{"1.0.0":"1.5.0"}\n');
    await Bun.$`git -C ${dir} add ${nested}`.quiet();
    await Bun.$`git -C ${dir} -c user.email=ci@sjer.red -c user.name=CI commit -m base`.quiet();
    await updateVersionsJson(versionsPath, nested, "1.1.0", "1.6.0", {}, dir);
    const staged = await Bun.$`git -C ${dir} diff --cached --name-only`.text();
    expect(staged.trim()).toBe(nested);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("versions update rejects malformed compatibility metadata", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cooklang-versions-invalid-"));
  const versionsPath = path.join(dir, "versions.json");
  try {
    await Bun.$`git -C ${dir} init -b main`.quiet();
    await Bun.write(
      versionsPath,
      '{"1.0.0":"1.5.0","not-a-version":"1.6.0"}\n',
    );
    await expect(
      updateVersionsJson(
        versionsPath,
        "versions.json",
        "1.1.0",
        "1.6.0",
        {},
        dir,
      ),
    ).rejects.toThrow(
      "versions.json must map semantic versions to semantic versions",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
