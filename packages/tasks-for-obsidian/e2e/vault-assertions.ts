import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const TASKS_DIR = "TaskNotes";

type VaultAssertion = {
  readonly name: string;
  readonly flow: string;
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
    flow: "01-create-task.yaml",
    check: (files) => fileWithTitle(files, "Created by e2e") !== undefined,
  },
  {
    name: '"Seeded open task" has status done (02-complete-task)',
    flow: "02-complete-task.yaml",
    check: (files) =>
      fileWithTitle(files, "Seeded open task")?.includes("status: done") ===
      true,
  },
  {
    name: 'the seeded task file is renamed to "Edited by e2e" (04-edit-task)',
    flow: "04-edit-task.yaml",
    check: (files) =>
      files
        .get("task-with-details-3c4d5e6f.md")
        ?.includes("title: Edited by e2e") === true,
  },
  {
    name: '"Seeded done task" has status open (10-completed-search-uncomplete)',
    flow: "10-completed-search-uncomplete.yaml",
    check: (files) =>
      fileWithTitle(files, "Seeded done task")?.includes("status: open") ===
      true,
  },
  {
    name: '"Context capture alpha" is persisted with a scheduled date (08-contextual-quick-capture)',
    flow: "08-contextual-quick-capture.yaml",
    check: (files) => {
      const content = fileWithTitle(files, "Context capture alpha");
      return content !== undefined && /^scheduled:/m.test(content);
    },
  },
  {
    name: '"Context capture beta" is persisted with a scheduled date (08-contextual-quick-capture)',
    flow: "08-contextual-quick-capture.yaml",
    check: (files) => {
      const content = fileWithTitle(files, "Context capture beta");
      return content !== undefined && /^scheduled:/m.test(content);
    },
  },
  {
    name: '"Water plants" stays open and gains a complete_instances entry (03-recurring-complete)',
    flow: "03-recurring-complete.yaml",
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
    flow: "07-swipe-actions.yaml",
    check: (files) =>
      fileWithTitle(files, "Swipe complete task")?.includes("status: done") ===
      true,
  },
  {
    name: '"Swipe delete task" is absent (07-swipe-actions)',
    flow: "07-swipe-actions.yaml",
    check: (files) => fileWithTitle(files, "Swipe delete task") === undefined,
  },
];

export async function assertVaultState(
  vaultDir: string,
  log: (message: string) => void,
  focusedFlow: string | null = null,
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
  const assertions =
    focusedFlow === null
      ? VAULT_ASSERTIONS
      : VAULT_ASSERTIONS.filter((assertion) => assertion.flow === focusedFlow);
  if (assertions.length === 0) {
    throw new Error(
      `no vault assertions registered for ${String(focusedFlow)}`,
    );
  }
  for (const assertion of assertions) {
    const passed = assertion.check(files);
    console.log(`[e2e] ${passed ? "PASS" : "FAIL"} — ${assertion.name}`);
    if (!passed) failures += 1;
  }
  if (failures > 0) {
    throw new Error(`${String(failures)} vault assertion(s) failed`);
  }
}
