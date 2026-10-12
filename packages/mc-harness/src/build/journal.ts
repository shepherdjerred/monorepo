import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { BlockPosSchema } from "#protocol/bridge.ts";
import { JOURNAL_DIR } from "#protocol/paths.ts";
import { boxesOverlap } from "#src/box.ts";

export const ApplyStatusSchema = z.enum([
  "applying",
  "verified",
  "failed",
  "undone",
]);

export const JournalEntrySchema = z.strictObject({
  version: z.literal(1),
  applyId: z.string().regex(/^apply-[0-9a-z-]+$/u),
  target: z.string(),
  buildDir: z.string(),
  world: z.string(),
  min: BlockPosSchema,
  max: BlockPosSchema,
  planHash: z.string(),
  /** Bridge snapshot of the box taken just before applying; undo restores it. */
  snapshotId: z.string(),
  siteHash: z.string(),
  status: ApplyStatusSchema,
  mismatches: z.number().int().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type JournalEntry = z.infer<typeof JournalEntrySchema>;

/** Applies per target, stored one JSON file each under ~/.toolkit/mc/journal/<target>/. */
export class Journal {
  constructor(private readonly root = JOURNAL_DIR) {}

  private file(target: string, applyId: string): string {
    return path.join(this.root, target, `${applyId}.json`);
  }

  static newId(now = new Date()): string {
    return `apply-${now.getTime().toString(36)}-${Math.floor(
      Math.random() * 36 ** 4,
    )
      .toString(36)
      .padStart(4, "0")}`;
  }

  async write(entry: JournalEntry): Promise<void> {
    await mkdir(path.join(this.root, entry.target), { recursive: true });
    await Bun.write(
      this.file(entry.target, entry.applyId),
      `${JSON.stringify(JournalEntrySchema.parse(entry), null, 2)}\n`,
    );
  }

  async list(target?: string): Promise<JournalEntry[]> {
    const targets =
      target === undefined
        ? await readdir(this.root).catch(() => [])
        : [target];
    const entries: JournalEntry[] = [];
    for (const name of targets) {
      const files = await readdir(path.join(this.root, name)).catch(() => []);
      for (const file of files.filter((candidate) =>
        candidate.endsWith(".json"),
      )) {
        entries.push(
          JournalEntrySchema.parse(
            await Bun.file(path.join(this.root, name, file)).json(),
          ),
        );
      }
    }
    return entries.toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async find(applyId: string): Promise<JournalEntry> {
    const entries = await this.list();
    const entry = entries.find((candidate) => candidate.applyId === applyId);
    if (entry === undefined) {
      throw new Error(`No journal entry ${applyId}`);
    }
    return entry;
  }

  /** Later applies on the same target that overlap and have not been undone (undo is LIFO). */
  async blockers(entry: JournalEntry): Promise<JournalEntry[]> {
    const entries = await this.list(entry.target);
    return entries.filter(
      (other) =>
        other.applyId !== entry.applyId &&
        other.createdAt > entry.createdAt &&
        other.status !== "undone" &&
        boxesOverlap(entry, other),
    );
  }
}
