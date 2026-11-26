// Shared Herdr layout, themes, mods, and alert sounds live once in packages/dotfiles and are
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

test("canonical Herdr source holds the layout, themes, mods, and alert sounds", () => {
  const canonical = listFiles(macHerdr);
  expect(canonical).toContain("layouts/mine.json");
  expect(canonical.some((file) => file.startsWith("themes/"))).toBe(true);
  expect(canonical.some((file) => file.startsWith("mods/"))).toBe(true);
  expect(canonical).toContain("sounds/agent-done.mp3");
  expect(canonical).toContain("sounds/agent-needs-attention.mp3");
});

test("Windows Herdr sync copies shared files and preserves destination-only files", async () => {
  const source = await Bun.file(syncTemplate).text();
  expect(source).toContain(
    'joinPath (dir .chezmoi.sourceDir) "dotfiles" "private_dot_config" "herdr-app"',
  );
  expect(source).toContain("layouts");
  expect(source).toContain("themes");
  expect(source).toContain("mods");
  expect(source).toContain('glob (joinPath $srcRoot "sounds" "**" "*")');
  expect(source).toContain("Sync-DirectoryTree 'sounds'");
  expect(source).not.toContain("Remove-Item");
  expect(source).toContain("gpui-kit.d.ts");
  expect(source).toContain("jsconfig.json");
  expect(source).toContain("sha256sum");
});

test("Windows Herdr settings reference the shared alert sounds", async () => {
  const settings: unknown = await Bun.file(
    path.join(windowsHerdr, "settings.json"),
  ).json();
  expect(settings).toMatchObject({
    sounds: {
      done: "sounds/agent-done.mp3",
      blocked: "sounds/agent-needs-attention.mp3",
    },
  });
});
