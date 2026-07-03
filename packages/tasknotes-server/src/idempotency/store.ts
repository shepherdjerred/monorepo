import { mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const RecordSchema = z.object({
  id: z.string(),
  method: z.string(),
  path: z.string(),
  status: z.number(),
  body: z.string(),
  ts: z.number(),
});

const FileSchema = z.array(RecordSchema);

export type IdempotencyRecord = z.infer<typeof RecordSchema>;

const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_RECORDS = 500;

/**
 * Persisted map of mutation-id → stored response, so a client replaying a
 * mutation (offline queue retry after a crash between server-ack and
 * client-dequeue) gets the original response instead of a second execution.
 *
 * Lives on the vault volume (a dot-directory, excluded from vault scans) so
 * dedup survives server restarts — that persistence IS the crash-safety
 * property. Writes are atomic (tmp + rename), matching the vault writer.
 *
 * Unlike task data, this file is a response cache: discarding it only
 * weakens replay dedup for mutations still in some client's queue, so a
 * failed parse logs loudly and starts empty rather than crash-looping the
 * pod on a state file that atomic writes should make impossible to corrupt.
 */
export class IdempotencyStore {
  private readonly records = new Map<string, IdempotencyRecord>();

  constructor(
    private readonly filePath: string,
    private readonly clock: () => number = Date.now,
  ) {}

  async init(): Promise<void> {
    const file = Bun.file(this.filePath);
    if (!(await file.exists())) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch (error) {
      console.error(
        `idempotency: failed to parse ${this.filePath}, starting empty`,
        error,
      );
      return;
    }
    const validated = FileSchema.safeParse(parsed);
    if (!validated.success) {
      console.error(
        `idempotency: invalid records in ${this.filePath}, starting empty:`,
        validated.error.message,
      );
      return;
    }
    const now = this.clock();
    for (const record of validated.data) {
      if (now - record.ts <= TTL_MS) {
        this.records.set(record.id, record);
      }
    }
  }

  get(id: string): IdempotencyRecord | undefined {
    const record = this.records.get(id);
    if (record === undefined) return undefined;
    if (this.clock() - record.ts > TTL_MS) {
      this.records.delete(id);
      return undefined;
    }
    return record;
  }

  /** Store a record and persist synchronously (ack-after-persist). */
  async put(record: IdempotencyRecord): Promise<void> {
    this.records.set(record.id, record);
    this.prune();
    await this.persist();
  }

  get size(): number {
    return this.records.size;
  }

  private prune(): void {
    const now = this.clock();
    for (const [id, record] of this.records) {
      if (now - record.ts > TTL_MS) {
        this.records.delete(id);
      }
    }
    if (this.records.size > MAX_RECORDS) {
      const oldestFirst = [...this.records.values()].sort(
        (a, b) => a.ts - b.ts,
      );
      const excess = this.records.size - MAX_RECORDS;
      for (const record of oldestFirst.slice(0, excess)) {
        this.records.delete(record.id);
      }
    }
  }

  private async persist(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.${String(process.pid)}.tmp`;
    await Bun.write(tmpPath, JSON.stringify([...this.records.values()]));
    await rename(tmpPath, this.filePath);
  }
}
