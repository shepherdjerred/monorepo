// Shared Herdr layout, themes, and mods live once in packages/dotfiles and are
// synced onto Windows as real files by run_onchange_after_sync-herdr-app.ps1.tmpl
// (Herdr on Windows does not load a mod's SVGs through a symlinked folder).
// Only Windows-specific settings.json and keys.json belong under
// packages/dotfiles-windows/private_dot_config/herdr-app.
import path from "node:path";
import { expect, test } from "vitest";

const macHerdr = path.join(
  import.meta.dirname,
  "../private_dot_config/herdr-app",
);
const windowsRoot = path.join(import.meta.dirname, "../../dotfiles-windows");
const windowsHerdr = path.join(windowsRoot, "private_dot_config/herdr-app");
const syncTemplate = path.join(
  windowsRoot,
  "run_onchange_after_sync-herdr-app.ps1.tmpl",
);

const generated = new Set(["gpui-kit.d.ts", "jsconfig.json"]);

function listFiles(root: string): string[] {
  return [...new Bun.Glob("**/*").scanSync({ cwd: root, dot: true })]
    .map((file) => file.replaceAll("\\", "/"))
    .filter((file) => !generated.has(path.basename(file)))
    .toSorted();
}

test("packages/dotfiles-windows keeps only Windows-specific Herdr configs", () => {
  expect(listFiles(windowsHerdr)).toEqual(["keys.json", "settings.json"]);
});

test("canonical macOS Herdr source still holds shared layout, themes, and mods", () => {
  const canonical = listFiles(macHerdr);
  expect(canonical).toContain("layouts/mine.json");
  expect(canonical.some((file) => file.startsWith("themes/"))).toBe(true);
  expect(canonical.some((file) => file.startsWith("mods/"))).toBe(true);
});

test("Windows Herdr sync template hashes and copies canonical layout, themes, and mods", async () => {
  const source = await Bun.file(syncTemplate).text();
  expect(source).toContain(
    'joinPath (dir .chezmoi.sourceDir) "dotfiles" "private_dot_config" "herdr-app"',
  );
  expect(source).toContain("layouts");
  expect(source).toContain("themes");
  expect(source).toContain("mods");
  expect(source).toContain("gpui-kit.d.ts");
  expect(source).toContain("jsconfig.json");
  expect(source).toContain("sha256sum");
});
