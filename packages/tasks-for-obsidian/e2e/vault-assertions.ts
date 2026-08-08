import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const TASKS_DIR = "TaskNotes";

type VaultAssertion = {
  readonly name: string;
  readonly flow: string;
  readonly check: (
    files: Map<string, string>,
    context: VaultAssertionContext,
  ) => boolean;
};

export type VaultAssertionContext = {
  readonly today: string;
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

function scheduledDate(content: string): string | undefined {
  return /^scheduled:\s*(\d{4}-\d{2}-\d{2})\s*$/m.exec(content)?.[1];
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function readVaultFiles(
  vaultDir: string,
): Promise<Map<string, string> | undefined> {
  const tasksDir = path.join(vaultDir, TASKS_DIR);
  try {
    const files = new Map<string, string>();
    for (const entry of await readdir(tasksDir)) {
      if (!entry.endsWith(".md")) continue;
      files.set(entry, await readFile(path.join(tasksDir, entry), "utf8"));
    }
    return files;
  } catch (error) {
    if (isMissingFileError(error)) return undefined;
    throw error;
  }
}

async function waitForVaultAssertions(
  vaultDir: string,
  assertions: readonly VaultAssertion[],
  context: VaultAssertionContext,
): Promise<Map<string, string>> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const files = await readVaultFiles(vaultDir);
    if (files === undefined) {
      if (Date.now() >= deadline) {
        throw new Error("vault changed while reading assertions");
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
      continue;
    }
    const failures = assertions.filter(
      (assertion) => !assertion.check(files, context),
    );
    if (failures.length === 0) return files;
    if (Date.now() >= deadline) {
      throw new Error(`${String(failures.length)} vault assertion(s) failed`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

const VAULT_ASSERTIONS: readonly VaultAssertion[] = [
  {
    name: 'a task file containing "Created by e2e" exists (01-create-task)',
    flow: "01-create-task.yaml",
    check: (files) => fileWithTitle(files, "Created by e2e") !== undefined,
  },
  {
    name: '"Offline created task" is persisted (05-offline-queue)',
    flow: "05-offline-queue.yaml",
    check: (files) =>
      fileWithTitle(files, "Offline created task") !== undefined,
  },
  {
    name: '"Offline crash task" is persisted after relaunch (06-offline-crash-replay)',
    flow: "06-offline-crash-replay.yaml",
    check: (files) => fileWithTitle(files, "Offline crash task") !== undefined,
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
      files.get("Edited by e2e.md")?.includes("title: Edited by e2e") ===
        true && !files.has("task-with-details-3c4d5e6f.md"),
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
    check: (files, context) => {
      const content = fileWithTitle(files, "Context capture alpha");
      return content !== undefined && scheduledDate(content) === context.today;
    },
  },
  {
    name: '"Context capture beta" is persisted with a scheduled date (08-contextual-quick-capture)',
    flow: "08-contextual-quick-capture.yaml",
    check: (files, context) => {
      const content = fileWithTitle(files, "Context capture beta");
      return content !== undefined && scheduledDate(content) === context.today;
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
  today: string,
): Promise<void> {
  const assertions =
    focusedFlow === null
      ? VAULT_ASSERTIONS
      : VAULT_ASSERTIONS.filter((assertion) => assertion.flow === focusedFlow);
  if (assertions.length === 0) {
    if (
      focusedFlow === "00-setup.yaml" ||
      focusedFlow === "09-saved-view-lifecycle.yaml"
    ) {
      log(`focused flow passed without vault mutation: ${focusedFlow}`);
      return;
    }
    throw new Error(
      `no vault assertions registered for ${String(focusedFlow)}`,
    );
  }

  const files = await waitForVaultAssertions(vaultDir, assertions, { today });
  log(
    `vault contains ${String(files.size)} task file(s): ${[...files.keys()].join(", ")}`,
  );
  for (const assertion of assertions) {
    console.log(`[e2e] PASS — ${assertion.name}`);
  }
}
