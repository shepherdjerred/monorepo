// The Windows chezmoi source carries real copies of the shared Herdr mods,
// layout and themes: Herdr on Windows does not load a mod's SVGs through a
// symlinked folder. Edit the macOS source, then copy each changed folder to
// packages/dotfiles-windows/private_dot_config/herdr-app.
import path from "node:path";
import { expect, test } from "vitest";

const mac = path.join(import.meta.dirname, "../private_dot_config/herdr-app");
const windows = path.join(
  import.meta.dirname,
  "../../dotfiles-windows/private_dot_config/herdr-app",
);

const shared = [
  "layouts/mine.json",
  "themes",
  "mods/agents-filter",
  "mods/my-agents",
  "mods/my-menu",
  "mods/my-spaces",
  "mods/my-status",
  "mods/my-tabs",
  "mods/my-worktree",
  "mods/spaces-nobranch",
];

// Files the app writes into a mod folder for editors; never part of a source.
const generated = new Set(["gpui-kit.d.ts", "jsconfig.json"]);

function files(root: string, entry: string): string[] {
  const pattern = entry.endsWith(".json") ? entry : `${entry}/**`;
  return [...new Bun.Glob(pattern).scanSync({ cwd: root, dot: true })]
    .map((file) => file.replaceAll("\\", "/"))
    .filter((file) => !generated.has(path.basename(file)))
    .toSorted();
}

test.each(shared)(
  "Windows copy of %s matches the macOS source",
  async (entry) => {
    const expected = files(mac, entry);
    expect(expected.length).toBeGreaterThan(0);
    expect(files(windows, entry)).toEqual(expected);
    for (const file of expected) {
      const [want, got] = await Promise.all([
        Bun.file(path.join(mac, file)).bytes(),
        Bun.file(path.join(windows, file)).bytes(),
      ]);
      expect(
        Buffer.from(got).equals(Buffer.from(want)),
        `${file} differs`,
      ).toBe(true);
    }
  },
);
