import { describe, expect, it } from "vitest";
import {
  createForumConfig,
  forumManifest,
  ManifestSchema,
} from "#src/config.ts";
describe("forum configuration contracts", () => {
  it("requires both appearance archives with immutable checksums", () => {
    const addons = forumManifest.vendorDependencies.filter(
      (dependency) => dependency.kind === "addon",
    );
    const styles = forumManifest.vendorDependencies.filter(
      (dependency) => dependency.kind === "style",
    );
    expect(
      ManifestSchema.safeParse({ ...forumManifest, vendorDependencies: addons })
        .success,
    ).toBe(false);
    expect(
      ManifestSchema.safeParse({
        ...forumManifest,
        vendorDependencies: [...addons, styles[0], styles[0]],
      }).success,
    ).toBe(false);
    expect(
      ManifestSchema.safeParse({
        ...forumManifest,
        vendorDependencies: [
          ...addons,
          ...styles.map((style) => ({ ...style, sha256: "not-a-digest" })),
        ],
      }).success,
    ).toBe(false);
  });
  it("requires a private backend and explicit node visibility", () => {
    expect(() =>
      ManifestSchema.parse({
        ...forumManifest,
        minecraft: { ...forumManifest.minecraft, host: "ts-mc.net" },
      }),
    ).toThrow();
    expect(() =>
      ManifestSchema.parse({
        ...forumManifest,
        nodes: [{ key: "reports", title: "Reports", type: "Forum" }],
      }),
    ).toThrow();
  });
  it("keeps registration closed until a managed flag explicitly enables it", async () => {
    expect(await createForumConfig().value("registrationEnabled")).toBe(false);
    const enabled = createForumConfig({
      name: "flag",
      get: () => Promise.resolve({ value: true }),
    });
    expect(await enabled.value("registrationEnabled")).toBe(true);
    const disabled = createForumConfig({
      name: "flag",
      get: () => Promise.resolve({ value: false }),
    });
    expect(await disabled.value("registrationEnabled")).toBe(false);
  });
  it("fails on an invalid present seasonal choice", async () => {
    const config = createForumConfig({
      name: "flag",
      get: () => Promise.resolve({ value: "unknown" }),
    });
    await expect(config.value("season")).rejects.toThrow();
  });
});
