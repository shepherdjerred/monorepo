// The Windows chezmoi source carries a real copy of the vendored
// modern-web-guidance skill: packages/dotfiles-windows has no shared
// skills tree, so the copy under its dot_agents/skills must match the
// macOS/Linux source in packages/dotfiles/dot_agents/skills.
import path from "node:path";
import { expect, test } from "vitest";

const mac = path.join(
  import.meta.dirname,
  "../dot_agents/skills/modern-web-guidance",
);
const windows = path.join(
  import.meta.dirname,
  "../../dotfiles-windows/dot_agents/skills/modern-web-guidance",
);

function files(root: string): string[] {
  return [...new Bun.Glob("**").scanSync({ cwd: root, dot: true })]
    .map((file) => file.replaceAll("\\", "/"))
    .toSorted();
}

test("Windows copy of modern-web-guidance matches the macOS source", async () => {
  const expected = files(mac);
  expect(expected.length).toBeGreaterThan(0);
  expect(files(windows)).toEqual(expected);
  for (const file of expected) {
    const [want, got] = await Promise.all([
      Bun.file(path.join(mac, file)).bytes(),
      Bun.file(path.join(windows, file)).bytes(),
    ]);
    expect(Buffer.from(got).equals(Buffer.from(want)), `${file} differs`).toBe(
      true,
    );
  }
});
