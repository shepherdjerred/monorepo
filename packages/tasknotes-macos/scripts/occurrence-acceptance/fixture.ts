import assert from "node:assert/strict";
import { lstat, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const rollingTitle = "Occurrence rolling parent";
export const repairTitle = "Occurrence repair parent";
export const childTitle = "Occurrence repair child";
export const repairParentPath = "Tasks/Repair.md";
export const repairChildPath = "Tasks/Repair-child.md";
export const templatePath = "Templates/missing.md";
export const restoredTemplate =
  "---\nstatus: open\n---\nRestored occurrence template body.\n";

/** Capture the viewer's civil day once; UTC arithmetic below only advances date-only values. */
export function viewerDay(now = new Date()): string {
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

export function followingDay(day: string, offset = 1): string {
  assert.match(day, /^\d{4}-\d{2}-\d{2}$/u);
  const date = new Date(`${day}T00:00:00Z`);
  assert.equal(date.toISOString().slice(0, 10), day);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function occurrenceFixture(day: string): Record<string, string> {
  followingDay(day);
  const stamp = `${day}T00:00:00Z`;
  const common = `status: open\npriority: normal\ntags: [task]\ndateCreated: ${stamp}\ndateModified: ${stamp}\n`;
  const start = day.replaceAll("-", "");
  return {
    "tasknotes.yaml":
      "title:\n  storage: frontmatter\ntask_detection:\n  method: tag\n  tag: task\ntemplating:\n  enabled: false\n  template_path: ''\n  failure_mode: error_abort\n  unknown_variable_policy: preserve\n",
    ".obsidian/plugins/tasknotes/data.json": JSON.stringify({
      tasksFolder: "Tasks",
      storeTitleInFilename: false,
      taskFilenameFormat: "title",
    }),
    "Reference.md":
      "# Occurrence acceptance\n\nThis exact reference must remain unchanged.\n",
    "Tasks/Rolling.md": `---\ntitle: ${rollingTitle}\n${common}id: occurrence-rolling\nrecurrence: DTSTART:${start};FREQ=DAILY;COUNT=3\nscheduled: ${day}\noccurrence_materialization: rolling\noccurrence_past_horizon: P0D\noccurrence_future_horizon: P2D\nvendor: {unchanged: rolling}\n---\nRolling parent body stays exact.\n`,
    [repairParentPath]: `---\ntitle: ${repairTitle}\n${common}id: occurrence-repair\nrecurrence: DTSTART:${start};FREQ=DAILY\nscheduled: ${day}\nrecurrence_anchor: completion\noccurrence_materialization: on_completion\noccurrence_next_trigger: completion\noccurrence_template: ${templatePath}\nvendor: {unchanged: repair}\n---\nRepair parent body stays exact.\n`,
    [repairChildPath]: `---\ntitle: ${childTitle}\n${common}recurrence_parent: '[[/${repairParentPath}]]'\noccurrence_date: ${day}\nscheduled: ${day}\nvendor: {unchanged: child}\ntimeEntries: opaque-preserved-history\n---\nCompleted child body stays exact.\n`,
  };
}

export async function seedOccurrenceVault(
  vault: string,
  day: string,
): Promise<void> {
  await mkdir(path.dirname(vault), { recursive: true });
  await mkdir(vault, { recursive: false });
  for (const [relative, bytes] of Object.entries(occurrenceFixture(day))) {
    const destination = path.join(vault, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, bytes, { flag: "wx", mode: 0o600 });
  }
}

export type OccurrenceNote = {
  path: string;
  bytes: string;
  properties: Record<string, unknown>;
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export async function readOccurrenceNotes(
  vault: string,
): Promise<OccurrenceNote[]> {
  const root = await lstat(vault);
  assert.ok(root.isDirectory() && !root.isSymbolicLink());
  const notes: OccurrenceNote[] = [];
  for await (const relative of new Bun.Glob("**/*.md").scan({ cwd: vault })) {
    assert.ok(
      !path.isAbsolute(relative) && !relative.split(path.sep).includes(".."),
    );
    const file = path.join(vault, relative);
    const metadata = await lstat(file);
    assert.ok(metadata.isFile() && !metadata.isSymbolicLink());
    const bytes = await Bun.file(file).text();
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(
      bytes,
    )?.[1];
    if (relative === "Reference.md" || relative === templatePath) continue;
    assert.ok(
      frontmatter !== undefined,
      `Task frontmatter is required: ${relative}`,
    );
    const properties: unknown = Bun.YAML.parse(frontmatter);
    assert.ok(
      record(properties),
      `Task frontmatter must be an object: ${relative}`,
    );
    notes.push({ path: relative, bytes, properties });
    assert.ok(notes.length <= 32, "Unexpected generated task count");
  }
  return notes;
}

export async function verifyOccurrenceVault(
  vault: string,
  day: string,
  phase: "completed" | "undone" | "repaired",
  completedChild?: string,
  completedParent?: string,
): Promise<{
  completedChild: string;
  completedParent: string;
  rolling: Record<string, string>;
}> {
  const fixture = occurrenceFixture(day);
  for (const relative of [
    "tasknotes.yaml",
    ".obsidian/plugins/tasknotes/data.json",
    "Reference.md",
    "Tasks/Rolling.md",
  ]) {
    assert.equal(
      await Bun.file(path.join(vault, relative)).text(),
      fixture[relative],
      `Collateral fixture change: ${relative}`,
    );
  }
  const notes = await readOccurrenceNotes(vault);
  const child = notes.find((note) => note.path === repairChildPath);
  assert.ok(child);
  assert.equal(
    child.properties["status"],
    "done",
    "The successful primary completion must persist",
  );
  assert.equal(child.properties["occurrence_date"], day);
  assert.equal(
    child.properties["recurrence_parent"],
    `[[/${repairParentPath}]]`,
  );
  assert.equal(child.properties["timeEntries"], "opaque-preserved-history");
  assert.ok(typeof child.properties["completedDate"] === "string");
  assert.ok(child.bytes.endsWith("Completed child body stays exact.\n"));
  if (completedChild !== undefined)
    assert.equal(
      child.bytes,
      completedChild,
      "Repair and Undo must never rewrite the already completed child",
    );
  const rollingChildren = notes.filter(
    (note) => note.properties["recurrence_parent"] === "[[/Tasks/Rolling.md]]",
  );
  assert.deepEqual(
    rollingChildren.map((note) => note.properties["occurrence_date"]).sort(),
    [day, followingDay(day), followingDay(day, 2)],
  );
  for (const note of rollingChildren)
    assert.equal(note.properties["status"], "open");
  const future = notes.filter(
    (note) =>
      note.path !== repairChildPath &&
      note.properties["recurrence_parent"] === `[[/${repairParentPath}]]`,
  );
  const parent = notes.find((note) => note.path === repairParentPath);
  assert.ok(parent);
  assert.deepEqual(parent.properties["complete_instances"], [day]);
  assert.deepEqual(parent.properties["vendor"], { unchanged: "repair" });
  assert.ok(parent.bytes.endsWith("Repair parent body stays exact.\n"));
  if (phase === "completed") {
    assert.notEqual(
      parent.bytes,
      fixture[repairParentPath],
      "Successful completion must project onto its parent",
    );
    assert.equal(
      await Bun.file(path.join(vault, templatePath)).exists(),
      false,
    );
    assert.equal(future.length, 0);
  } else {
    assert.ok(
      completedParent !== undefined,
      "The exact already committed parent must be retained",
    );
    assert.equal(
      parent.bytes,
      completedParent,
      "Repair and its Undo must preserve the completed parent's exact bytes",
    );
    assert.equal(
      await Bun.file(path.join(vault, templatePath)).text(),
      restoredTemplate,
    );
    if (phase === "undone") assert.equal(future.length, 0);
    else {
      assert.equal(
        future.length,
        1,
        "Exactly one repaired future child is required",
      );
      assert.equal(future[0]?.properties["occurrence_date"], followingDay(day));
      assert.equal(future[0]?.properties["status"], "open");
      assert.ok(
        future[0]?.bytes.endsWith("Restored occurrence template body.\n"),
      );
    }
  }
  assert.equal(
    notes.length,
    phase === "repaired" ? 7 : 6,
    "No duplicate or unrelated generated Markdown is allowed",
  );
  return {
    completedChild: child.bytes,
    completedParent: parent.bytes,
    rolling: Object.fromEntries(
      rollingChildren.map((note) => [note.path, note.bytes]),
    ),
  };
}
