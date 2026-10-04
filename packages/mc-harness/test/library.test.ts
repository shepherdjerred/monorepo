import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PROGRAM_TEMPLATE } from "#build/commands.ts";
import { libraryList, libraryShow, libraryUse } from "#build/library.ts";

describe("build library", () => {
  it("lists, filters and shows entries", async () => {
    const all = await libraryList({ tags: [] });
    expect(all.length).toBeGreaterThanOrEqual(6);
    const desert = await libraryList({ tags: ["desert"] });
    expect(desert.map((row) => row.slug)).toEqual(["desert-l-house"]);
    const shown = await libraryShow("cottage");
    expect(shown.source).toContain("satisfies BuildProgram");
  });

  it("replaces the init scaffold but not an edited build.ts without --force", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "library-use-"));
    const program = path.join(dir, "build.ts");
    await writeFile(program, PROGRAM_TEMPLATE);
    const first = await libraryUse("cottage", dir, { force: false });
    expect(first.replaced).toBe(true);
    expect(await Bun.file(program).text()).toContain("timber cottage");
    await writeFile(program, "// my edits\n");
    await expect(
      libraryUse("watchtower", dir, { force: false }),
    ).rejects.toThrow(/--force/u);
    await libraryUse("watchtower", dir, { force: true });
    expect(await Bun.file(program).text()).toContain("watchtower");
  });
});
