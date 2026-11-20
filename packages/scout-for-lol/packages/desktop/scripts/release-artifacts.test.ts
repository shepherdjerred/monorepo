import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  artifactContentType,
  macDryRunDirectory,
  macOutputDirectory,
  readLocalArtifacts,
} from "./release-artifacts.ts";

async function checkout(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "scout-release-"));
  await mkdir(join(root, "dist", "stable", "macos"), { recursive: true });
  return root;
}

async function windowsOutputs(root: string, version: string) {
  const name = `Scout Desktop_${version}_x64-setup.exe`;
  await writeFile(join(root, "dist", "stable", name), "exe");
  await writeFile(
    join(root, "dist", "stable", `${name}.sig`),
    "c2lnbmF0dXJl\n",
  );
}

async function macOutputs(root: string, version: string, skip?: string) {
  const directory = macOutputDirectory(root, "stable");
  const files = {
    [`scout-desktop-stable_${version}_universal.app.tar.gz`]: "tgz",
    [`scout-desktop-stable_${version}_universal.app.tar.gz.sig`]:
      "bWFjc2lnbmF0dXJl\n",
    [`scout-desktop-stable_${version}_universal.dmg`]: "dmg",
  };
  for (const [name, body] of Object.entries(files)) {
    if (name !== skip) await writeFile(join(directory, name), body);
  }
}

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe("local release outputs", () => {
  test("a Windows host's installer is published under its channel name", async () => {
    const root = await checkout();
    await windowsOutputs(root, "0.2.0");
    const [windows, ...rest] = await readLocalArtifacts(
      root,
      "stable",
      "0.2.0",
    );
    expect(rest).toEqual([]);
    expect(windows?.platform).toBe("windows-x86_64");
    expect(windows?.fileName).toBe("scout-desktop-stable_0.2.0_x64-setup.exe");
    expect(windows?.signature).toBe("c2lnbmF0dXJl");
    expect(windows?.companions).toEqual([]);
  });

  test("a macOS host's archive carries the disk image beside it", async () => {
    const root = await checkout();
    await macOutputs(root, "0.2.0");
    const [mac, ...rest] = await readLocalArtifacts(root, "stable", "0.2.0");
    expect(rest).toEqual([]);
    expect(mac?.platform).toBe("darwin-universal");
    expect(mac?.fileName).toBe(
      "scout-desktop-stable_0.2.0_universal.app.tar.gz",
    );
    expect(text(mac?.body ?? new Uint8Array())).toBe("tgz");
    expect(mac?.signature).toBe("bWFjc2lnbmF0dXJl");
    expect(mac?.companions.map(({ fileName }) => fileName)).toEqual([
      "scout-desktop-stable_0.2.0_universal.dmg",
    ]);
    expect(mac?.companions[0]?.contentType).toBe(
      "application/x-apple-diskimage",
    );
  });

  test("both platforms are read when both hosts' outputs are present", async () => {
    const root = await checkout();
    await windowsOutputs(root, "0.2.0");
    await macOutputs(root, "0.2.0");
    const found = await readLocalArtifacts(root, "stable", "0.2.0");
    expect(found.map(({ platform }) => platform)).toEqual([
      "windows-x86_64",
      "darwin-universal",
    ]);
  });

  test("another version's outputs are not this release", async () => {
    const root = await checkout();
    await windowsOutputs(root, "0.1.0");
    await macOutputs(root, "0.1.0");
    await expect(readLocalArtifacts(root, "stable", "0.2.0")).rejects.toThrow(
      /No signed stable 0.2.0 outputs/,
    );
  });

  test("a partial macOS output is refused rather than skipped", async () => {
    for (const missing of [
      "scout-desktop-stable_0.2.0_universal.app.tar.gz.sig",
      "scout-desktop-stable_0.2.0_universal.dmg",
    ]) {
      const root = await checkout();
      await macOutputs(root, "0.2.0", missing);
      await expect(readLocalArtifacts(root, "stable", "0.2.0")).rejects.toThrow(
        /a macOS release needs/,
      );
    }
  });

  test("an unsigned Windows installer is refused", async () => {
    const root = await checkout();
    await writeFile(
      join(root, "dist", "stable", "Scout Desktop_0.2.0_x64-setup.exe"),
      "exe",
    );
    await expect(readLocalArtifacts(root, "stable", "0.2.0")).rejects.toThrow(
      /has no \.sig/,
    );
  });

  test("an unsigned dry run is never a publication input", async () => {
    const root = await checkout();
    expect(macDryRunDirectory(root, "stable")).not.toBe(
      macOutputDirectory(root, "stable"),
    );
    const dryRun = macDryRunDirectory(root, "stable");
    await mkdir(dryRun, { recursive: true });
    for (const name of [
      "scout-desktop-stable_0.2.0_universal.app.tar.gz",
      "scout-desktop-stable_0.2.0_universal.dmg",
    ]) {
      await writeFile(join(dryRun, name), "unsigned");
    }
    await expect(readLocalArtifacts(root, "stable", "0.2.0")).rejects.toThrow(
      /No signed/,
    );
  });

  test("uploads carry each format's content type", () => {
    expect(artifactContentType("windows-x86_64")).toBe(
      "application/vnd.microsoft.portable-executable",
    );
    expect(artifactContentType("darwin-universal")).toBe("application/gzip");
  });
});
