import { describe, expect, it } from "vitest";
import { renderCard, CardSchema } from "#src/render.ts";
import { themeCatalog } from "#src/catalog.ts";
import docs from "#data/docs.json";

describe("calendar share cards", () => {
  it("renders distinct 1200×630 images for calendar themes and public page titles", async () => {
    const base = {
      section: "Minecraft community",
      title: "Welcome to The Storm",
      description: "Build, explore, and catch up.",
    };
    const halloween = await renderCard({ ...base, theme: "halloween" });
    const christmas = await renderCard({ ...base, theme: "christmas" });
    expect(Buffer.from(halloween).subarray(1, 4).toString()).toBe("PNG");
    expect(Buffer.from(halloween).readUInt32BE(16)).toBe(1200);
    expect(Buffer.from(halloween).readUInt32BE(20)).toBe(630);
    expect(Buffer.from(halloween).equals(Buffer.from(christmas))).toBe(false);
    const long = await renderCard({
      ...base,
      theme: "valentines",
      title:
        "A very long community announcement about towns, ranks, quests, resource worlds, holiday events, and everything coming next",
    });
    expect(long.length).toBeGreaterThan(1000);
  });
  it("bounds rendering inputs and rejects unknown catalog themes", () => {
    expect(
      CardSchema.safeParse({
        theme: "unknown",
        title: "x",
        section: "x",
        description: "",
      }).success,
    ).toBe(false);
    expect(
      CardSchema.safeParse({
        theme: themeCatalog.themes[0]?.id,
        title: "x".repeat(251),
        section: "x",
        description: "",
      }).success,
    ).toBe(false);
  });
  it("keeps the public docs title manifest aligned with actual pages", async () => {
    for (const [path, title] of Object.entries(docs)) {
      const file =
        path === "/"
          ? "index.md"
          : path === "/survival/"
            ? "survival/index.md"
            : path.slice(1, -1) + ".md";
      const body = await Bun.file(
        new URL("../../ts-mc-docs/src/content/docs/" + file, import.meta.url),
      ).text();
      expect(body).toContain("title: " + title + "\n");
    }
  });
});
