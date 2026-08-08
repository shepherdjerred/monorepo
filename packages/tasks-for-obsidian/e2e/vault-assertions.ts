import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const TASKS_DIR = "TaskNotes";

type VaultAssertion = {
  readonly name: string;
  readonly check: (files: Map<string, string>) => boolean;
};

function fileWithTitle(
  files: Map<string, string>,
  title: string,
): string | undefined {
  for (const content of files.values()) {
    if (content.includes(`title: ${title}`)) return content;
  }
  return undefined;
}

const VAULT_ASSERTIONS: readonly VaultAssertion[] = [
  {
    name: 'a task file containing "Created by e2e" exists (01-create-task)',
    check: (files) => fileWithTitle(files, "Created by e2e") !== undefined,
  },
  {
    name: '"Seeded open task" has status done (02-complete-task)',
    check: (files) =>
      fileWithTitle(files, "Seeded open task")?.includes("status: done") ===
      true,
  },
  {
    name: 'a task file containing "Edited by e2e" exists (04-edit-task)',
    check: (files) => fileWithTitle(files, "Edited by e2e") !== undefined,
  },
  {
    name: '"Seeded done task" has status open (10-completed-search-uncomplete)',
    check: (files) =>
      fileWithTitle(files, "Seeded done task")?.includes("status: open") ===
      true,
  },
  {
    name: '"Context capture alpha" is persisted with a scheduled date (08-contextual-quick-capture)',
    check: (files) => {
      const content = fileWithTitle(files, "Context capture alpha");
      return content !== undefined && /^scheduled:/m.test(content);
    },
  },
  {
    name: '"Context capture beta" is persisted with a scheduled date (08-contextual-quick-capture)',
    check: (files) => {
      const content = fileWithTitle(files, "Context capture beta");
      return content !== undefined && /^scheduled:/m.test(content);
    },
  },
  {
    name: '"Water plants" stays open and gains a complete_instances entry (03-recurring-complete)',
    check: (files) => {
      const content = fileWithTitle(files, "Water plants");
      if (content === undefined) return false;
      return (
        content.includes("status: open") &&
        /complete_instances:\n\s+- /.test(content)
      );
    },
  },
  {
    name: '"Swipe complete task" has status done (07-swipe-actions)',
    check: (files) =>
      fileWithTitle(files, "Swipe complete task")?.includes("status: done") ===
      true,
  },
  {
    name: '"Swipe delete task" is absent (07-swipe-actions)',
    check: (files) => fileWithTitle(files, "Swipe delete task") === undefined,
  },
];

export async function assertVaultState(
  vaultDir: string,
  log: (message: string) => void,
): Promise<void> {
  const tasksDir = path.join(vaultDir, TASKS_DIR);
  const files = new Map<string, string>();
  for (const entry of await readdir(tasksDir)) {
    if (!entry.endsWith(".md")) continue;
    files.set(entry, await readFile(path.join(tasksDir, entry), "utf8"));
  }
  log(
    `vault contains ${String(files.size)} task file(s): ${[...files.keys()].join(", ")}`,
  );

  let failures = 0;
  for (const assertion of VAULT_ASSERTIONS) {
    const passed = assertion.check(files);
    console.log(`[e2e] ${passed ? "PASS" : "FAIL"} — ${assertion.name}`);
    if (!passed) failures += 1;
  }
  if (failures > 0) {
    throw new Error(`${String(failures)} vault assertion(s) failed`);
  }
}
