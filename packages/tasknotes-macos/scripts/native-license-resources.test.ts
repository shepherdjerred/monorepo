import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  generateNativeNotices,
  parseNoticeArguments,
} from "./generate-native-notices.ts";
import { validateNativeLicenseResources } from "./native-license-resources.ts";

describe("native bundle license resources", () => {
  test("parses notice CLI arguments and rejects unknown platforms or missing portable output dirs", () => {
    expect(parseNoticeArguments(["--ios"], "/repo")).toEqual({
      platform: "ios",
    });
    expect(
      parseNoticeArguments(
        ["--platform", "windows", "--output-dir", "out/notices"],
        "/repo",
      ),
    ).toEqual({
      platform: "windows",
      outputDirectory: "/repo/out/notices",
    });
    expect(() =>
      parseNoticeArguments(["--platform", "windows"], "/repo"),
    ).toThrow("explicit output directory");
    expect(() => parseNoticeArguments(["--unknown"], "/repo")).toThrow(
      "Unknown native notice argument",
    );
  });

  test("generates pure-Swift iOS and macOS notice bundles without Cargo dependencies", async () => {
    const directory = await mkdtemp(join(tmpdir(), "facet-notice-gen-"));
    try {
      const macRoot = join(directory, "packages/tasknotes-macos");
      await mkdir(join(macRoot, "scripts"), { recursive: true });
      await mkdir(join(macRoot, ".build/checkouts/KeyboardShortcuts"), {
        recursive: true,
      });
      await Bun.write(join(directory, "LICENSE"), "GPL-3.0-only text\n");
      await Bun.write(
        join(macRoot, "scripts/generate-native-notices.ts"),
        "// producer\n",
      );
      await Bun.write(join(macRoot, "Package.swift"), "// manifest\n");
      await Bun.write(
        join(macRoot, "Package.resolved"),
        JSON.stringify({
          pins: [
            {
              identity: "keyboardshortcuts",
              state: { version: "3.1.0" },
            },
          ],
        }),
      );
      await Bun.write(
        join(macRoot, ".build/checkouts/KeyboardShortcuts/license"),
        "MIT License\n",
      );

      const iosResult = await generateNativeNotices({
        platform: "ios",
        repoRoot: directory,
      });
      expect(iosResult.count).toBe(0);

      const macResult = await generateNativeNotices({
        platform: "macos",
        repoRoot: directory,
      });
      expect(macResult.count).toBe(1);
      expect(
        await Bun.file(
          join(macResult.destination, "ThirdPartyNotices.txt"),
        ).text(),
      ).toContain("KeyboardShortcuts 3.1.0 (MIT)");
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  test("requires exact current notices, provenance, and root license in extension bundles", async () => {
    const directory = await mkdtemp(join(tmpdir(), "facet-native-license-"));
    try {
      const generated = join(directory, "generated");
      const resources = join(directory, "TasksWidget.appex");
      await Promise.all([mkdir(generated), mkdir(resources)]);
      const license = join(directory, "LICENSE");
      await Bun.write(license, "exact first-party GPL text\n");
      for (const name of [
        "FirstPartyLicense.txt",
        "ThirdPartyNotices.txt",
        "native-license-inventory.json",
      ]) {
        const bytes =
          name === "FirstPartyLicense.txt"
            ? await Bun.file(license).text()
            : `current ${name}\n`;
        await Bun.write(join(generated, name), bytes);
        await Bun.write(join(resources, name), bytes);
      }
      await expect(
        validateNativeLicenseResources(resources, generated, license),
      ).resolves.toBeUndefined();
      for (const name of [
        "FirstPartyLicense.txt",
        "ThirdPartyNotices.txt",
        "native-license-inventory.json",
      ]) {
        await Bun.write(join(resources, name), "different bytes");
        await expect(
          validateNativeLicenseResources(resources, generated, license),
        ).rejects.toThrow("does not match");
        await rm(join(resources, name));
        await expect(
          validateNativeLicenseResources(resources, generated, license),
        ).rejects.toThrow("missing native license resource");
        await Bun.write(
          join(resources, name),
          await Bun.file(join(generated, name)).arrayBuffer(),
        );
      }
    } finally {
      await rm(directory, { recursive: true });
    }
  });
});
