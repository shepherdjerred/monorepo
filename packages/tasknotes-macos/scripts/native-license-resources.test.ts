import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { validateNativeLicenseResources } from "./native-license-resources.ts";

describe("native bundle license resources", () => {
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
