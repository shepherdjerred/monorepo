// The Windows chezmoi source carries a real copy of the vendored
// modern-web-guidance skill: packages/dotfiles-windows has no shared
// skills tree, so the copy under its dot_agents/skills must match the
// macOS/Linux source in packages/dotfiles/dot_agents/skills.
import { readdir } from "node:fs/promises";
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

async function files(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) =>
      path
        .relative(root, path.join(entry.parentPath, entry.name))
        .replaceAll("\\", "/"),
    )
    .toSorted();
}

async function hashes(root: string): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  for (const file of await files(root)) {
    const bytes = await Bun.file(path.join(root, file)).bytes();
    result.set(
      file,
      new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
    );
  }
  return result;
}

test("Windows copy of modern-web-guidance matches the macOS source", async () => {
  const expected = await hashes(mac);
  expect(expected.size).toBeGreaterThan(0);
  expect(await hashes(windows)).toEqual(expected);
});
