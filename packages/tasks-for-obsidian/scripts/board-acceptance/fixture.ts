import assert from "node:assert/strict";
import { lstat, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  followingDay,
  viewerDay,
} from "tasknotes-macos/scripts/occurrence-acceptance/fixture.ts";

export const boardViewName = "Board acceptance";
export type BoardViewer = { day: string; timeZone: string };

export function boardViewer(): BoardViewer {
  return {
    day: viewerDay(),
    timeZone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

export function boardFixture(day: string): Record<string, string> {
  const timestamp = `${followingDay(day, -2)}T12:00:00Z`;
  const fixture: Record<string, string> = {
    "tasknotes.yaml":
      "title:\n  storage: frontmatter\ntask_detection:\n  method: tag\n  tag: task\nstatus:\n  values: [open, doing, done]\n  completed_values: [done]\n  default: open\n",
    ".obsidian/plugins/tasknotes/data.json": JSON.stringify({
      // A plugin defaultTaskStatus would replace the portable workflow section.
      tasksFolder: "Tasks",
      storeTitleInFilename: false,
      taskFilenameFormat: "title",
    }),
    "Reference.md":
      "# Board acceptance reference\n\nUnchanged [[Tasks/Card-095]] and **Markdown**.\n",
    "Assets/unchanged.txt": "Board fixture attachment remains exact.\n",
    "Facet/Views/board-acceptance.md": `---\nfacetView: { schemaVersion: 1, name: '${boardViewName}', viewType: board, symbol: tray, tint: '#0a84ff', favorite: true, order: 0, query: { scope: all, completed: false, sortField: title, sortDirection: asc } }\n---\n`,
  };
  for (let index = 1; index <= 120; index += 1) {
    const number = String(index).padStart(3, "0");
    const status = index % 2 === 1 ? "open" : "doing";
    fixture[`Tasks/Card-${number}.md`] =
      `---\ntitle: Board card ${number}\nstatus: ${status}\npriority: normal\ntags: [task]\ndateCreated: '${timestamp}'\ndateModified: '${timestamp}'\nvendorBoard: { sequence: ${index}, preserve: 'punctuation: exact' }\n---\nCard ${number} preserves **Markdown**, [[Reference]], and trailing spaces.  \nSecond line.\n`;
  }
  return fixture;
}

export async function seedBoardVault(
  vault: string,
  day: string,
): Promise<void> {
  await mkdir(path.dirname(vault), { recursive: true });
  await mkdir(vault, { recursive: false });
  for (const [relative, bytes] of Object.entries(boardFixture(day))) {
    const destination = path.join(vault, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, bytes, { flag: "wx", mode: 0o600 });
  }
}

async function inventory(directory: string, prefix = ""): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    assert.ok(!entry.isSymbolicLink(), `Unexpected symlink: ${relative}`);
    if (entry.isDirectory()) {
      files.push(
        ...(await inventory(path.join(directory, entry.name), relative + "/")),
      );
    } else {
      assert.ok(entry.isFile(), `Unexpected non-file: ${relative}`);
      files.push(relative);
    }
  }
  return files.sort();
}

export async function verifyBoardVault(
  vault: string,
  day: string,
): Promise<{
  taskCount: number;
  markdownCount: number;
  hashes: Record<string, string>;
}> {
  const metadata = await lstat(vault);
  assert.ok(metadata.isDirectory() && !metadata.isSymbolicLink());
  const fixture = boardFixture(day);
  assert.deepEqual(
    await inventory(vault),
    Object.keys(fixture).sort(),
    "Board acceptance must preserve the exact file set",
  );
  const hashes: Record<string, string> = {};
  for (const [relative, expected] of Object.entries(fixture)) {
    const actual = await Bun.file(path.join(vault, relative)).text();
    assert.equal(
      actual,
      expected,
      `Board acceptance changed bytes: ${relative}`,
    );
    hashes[relative] = new Bun.CryptoHasher("sha256")
      .update(actual)
      .digest("hex");
  }
  const taskCount = Object.keys(fixture).filter((name) =>
    name.startsWith("Tasks/"),
  ).length;
  const markdownCount = Object.keys(fixture).filter((name) =>
    name.endsWith(".md"),
  ).length;
  assert.equal(taskCount, 120);
  assert.equal(markdownCount, 122);
  return { taskCount, markdownCount, hashes };
}
