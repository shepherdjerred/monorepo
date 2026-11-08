import assert from "node:assert/strict";
import { lstat, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { timedViewerWitness } from "./native-acceptance/timed-viewer-witness.ts";
import {
  followingDay,
  viewerDay,
} from "tasknotes-macos/scripts/occurrence-acceptance/fixture.ts";

export type ParityViewer = { day: string; timeZone: string };
export type ParityPhase = "collections" | "mutations" | "controls";
export const capturedTitle = "Parity captured sentinel";
export const savedViewTitle = "Parity saved view";
export const searchTag = "parity-search-needle";
export const reschedulePath = "Tasks/Reschedule.md";
export const timedViewerPath = "Tasks/TimedViewerDay.md";
export const timedViewerTitle = "Parity timed viewer day";

export function parityViewer(): ParityViewer {
  return {
    day: viewerDay(),
    timeZone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

export function parityFixture(day: string): Record<string, string> {
  followingDay(day);
  const created = `${followingDay(day, -2)}T12:00:00Z`;
  const timestamps = `dateCreated: '${created}'\ndateModified: '${created}'\n`;
  const common = `status: open\npriority: normal\ntags: [task]\n${timestamps}`;
  const taskNote = (title: string, fields: string, body: string): string =>
    `---\ntitle: ${title}\n${common}${fields}---\n${body}\n`;
  return {
    "tasknotes.yaml":
      "title:\n  storage: frontmatter\ntask_detection:\n  method: tag\n  tag: task\n",
    ".obsidian/plugins/tasknotes/data.json": JSON.stringify({
      tasksFolder: "Tasks",
      storeTitleInFilename: false,
      taskFilenameFormat: "title",
      defaultTaskStatus: "open",
    }),
    "Reference.md":
      "# Mobile parity reference\n\nUntouched links, [[Tasks/Reschedule]] and spacing stay exact.\n",
    "Assets/unchanged.txt": "Synthetic attachment bytes stay exact.\n",
    "Tasks/Overdue.md": taskNote(
      "Parity overdue task",
      `due: '${followingDay(day, -1)}'\n`,
      "Overdue note stays unchanged.",
    ),
    "Tasks/Planned.md": taskNote(
      "Parity planned today",
      `scheduled: '${day}'\n`,
      "Planned note stays unchanged.",
    ),
    "Tasks/Due.md": taskNote(
      "Parity due today",
      `due: '${day}'\n`,
      "Deadline note stays unchanged.",
    ),
    [timedViewerPath]: taskNote(
      timedViewerTitle,
      `due: '${timedViewerWitness(day).source}'\n`,
      "The timed deadline belongs to the viewer day, not its written date prefix.",
    ),
    "Tasks/Future.md": taskNote(
      "Parity distant future",
      `due: '${followingDay(day, 14)}'\n`,
      "Fourteen-day future note stays unchanged.",
    ),
    "Tasks/Metadata.md": `---\ntitle: Parity scoped metadata task\nstatus: open\npriority: high\ntags: [task, ${searchTag}]\n${timestamps}projects: ['[[Metadata sentinel]]']\ndue: '${followingDay(day, 3)}'\n---\nSearch by organization metadata, not this text.\n`,
    [reschedulePath]: taskNote(
      "Parity reschedule task",
      "contexts: [phone]\nvendorParity: { exact: 'preserve: punctuation', falsey: false }\ntimeEntries: opaque-preserved-history\n",
      "Reschedule body keeps **Markdown**, [[Reference]], and trailing spaces.  \nSecond line.",
    ),
  };
}

export async function seedParityVault(
  vault: string,
  day: string,
): Promise<void> {
  await mkdir(path.dirname(vault), { recursive: true });
  await mkdir(vault, { recursive: false });
  for (const [relative, bytes] of Object.entries(parityFixture(day))) {
    const destination = path.join(vault, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, bytes, { flag: "wx", mode: 0o600 });
  }
}

function note(source: string): {
  properties: Record<string, unknown>;
  body: string;
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(source);
  assert.ok(match?.[1] !== undefined, "Expected Markdown frontmatter");
  return {
    properties: z
      .record(z.string(), z.unknown())
      .parse(Bun.YAML.parse(match[1])),
    body: source.slice(match[0].length),
  };
}

export async function verifyParityVault(
  vault: string,
  day: string,
  phase: ParityPhase,
): Promise<{ markdownHashes: Record<string, string> }> {
  const root = await lstat(vault);
  assert.ok(root.isDirectory() && !root.isSymbolicLink());
  const fixture = parityFixture(day);
  for (const [relative, original] of Object.entries(fixture)) {
    if (phase !== "collections" && relative === reschedulePath) continue;
    assert.equal(
      await Bun.file(path.join(vault, relative)).text(),
      original,
      `Collateral fixture change: ${relative}`,
    );
  }
  const { hashes, created, views } = await inventory(vault, fixture);
  assert.equal(
    Object.keys(hashes).length,
    phase === "collections" ? 8 : phase === "mutations" ? 9 : 10,
    "Unexpected added, missing or duplicate Markdown",
  );
  assert.equal(created.length, phase === "collections" ? 0 : 1);
  assert.equal(views.length, phase === "controls" ? 1 : 0);
  if (phase !== "collections") await verifyMutations(vault, day, created);
  if (phase === "controls") await verifyView(vault, views);
  return { markdownHashes: hashes };
}

async function inventory(
  vault: string,
  fixture: Record<string, string>,
): Promise<{
  hashes: Record<string, string>;
  created: string[];
  views: string[];
}> {
  const markdown = [...new Bun.Glob("**/*.md").scanSync({ cwd: vault })].sort();
  const hashes: Record<string, string> = {};
  const created: string[] = [];
  const views: string[] = [];
  for (const relative of markdown) {
    assert.ok(
      !path.isAbsolute(relative) && !relative.split(path.sep).includes(".."),
    );
    const filename = path.join(vault, relative);
    const metadata = await lstat(filename);
    assert.ok(metadata.isFile() && !metadata.isSymbolicLink());
    hashes[relative] = new Bun.CryptoHasher("sha256")
      .update(await Bun.file(filename).bytes())
      .digest("hex");
    if (relative.startsWith("Facet/Views/")) views.push(relative);
    else if (fixture[relative] === undefined) created.push(relative);
  }
  return { hashes, created, views };
}

async function verifyMutations(
  vault: string,
  day: string,
  created: string[],
): Promise<void> {
  const capturedPath = z.tuple([z.string()]).parse(created)[0];
  const captured = note(await Bun.file(path.join(vault, capturedPath)).text());
  z.object({
    title: z.literal(capturedTitle),
    status: z.literal("open"),
    scheduled: z.literal(day),
    tags: z.array(z.string()).refine((values) => values.includes("task")),
  }).parse(captured.properties);
  assert.equal(
    Object.hasOwn(captured.properties, "due"),
    false,
    "Context-only capture must not invent a deadline",
  );
  const rescheduledSource = await Bun.file(
    path.join(vault, reschedulePath),
  ).text();
  const rescheduled = note(rescheduledSource);
  const originalReschedule = z
    .string()
    .parse(parityFixture(day)[reschedulePath]);
  const original = note(originalReschedule);
  assert.equal(rescheduled.properties["scheduled"], followingDay(day));
  assert.equal(rescheduled.body, original.body);
  assert.equal(
    rescheduled.properties["timeEntries"],
    "opaque-preserved-history",
  );
  const unchanged = { ...rescheduled.properties };
  z.iso.datetime().parse(unchanged["dateModified"]);
  delete unchanged["scheduled"];
  delete unchanged["dateModified"];
  const originalUnchanged = { ...original.properties };
  delete originalUnchanged["dateModified"];
  assert.deepEqual(
    unchanged,
    originalUnchanged,
    "Scheduling changed unrelated properties",
  );
  for (const line of originalReschedule
    .split("\n")
    .filter(
      (value) =>
        value.startsWith("vendorParity:") ||
        value.startsWith("timeEntries:") ||
        value.startsWith("dateCreated:"),
    )) {
    assert.ok(
      rescheduledSource.includes(line),
      "Untouched property bytes changed",
    );
  }
}

async function verifyView(vault: string, views: string[]): Promise<void> {
  const viewPath = z.tuple([z.string()]).parse(views)[0];
  const portable = note(await Bun.file(path.join(vault, viewPath)).text());
  z.object({
    facetView: z.object({
      name: z.literal(savedViewTitle),
      favorite: z.literal(true),
      query: z.object({
        scope: z.literal("all"),
        tags: z.tuple([z.literal(searchTag)]),
        sortField: z.literal("title"),
      }),
    }),
  }).parse(portable.properties);
}
