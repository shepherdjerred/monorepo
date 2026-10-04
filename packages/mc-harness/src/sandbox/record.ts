import { chmod, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { SandboxSummarySchema, type SandboxSummary } from "#protocol/ipc.ts";
import { SANDBOXES_DIR } from "#protocol/paths.ts";

/**
 * A sandbox as the daemon persists it. This is the only place the bridge token
 * and RCON password live outside the container; the file is written 0600 and
 * never returned over IPC (see `toSummary`).
 */
export const SandboxRecordSchema = SandboxSummarySchema.extend({
  containerId: z.string().min(12),
  owner: z.string(),
  secrets: z.strictObject({
    bridgeToken: z.string().regex(/^[0-9a-f]{48}$/u),
    rconPassword: z.string().regex(/^[0-9a-f]{48}$/u),
  }),
});
export type SandboxRecord = z.infer<typeof SandboxRecordSchema>;

export function toSummary(record: SandboxRecord): SandboxSummary {
  return SandboxSummarySchema.parse({
    id: record.id,
    provider: record.provider,
    profile: record.profile,
    world: record.world,
    status: record.status,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    keep: record.keep,
    bootMs: record.bootMs,
    endpoints: record.endpoints,
  });
}

/** Persists sandbox records under one directory per sandbox. */
export class SandboxStore {
  constructor(private readonly root = SANDBOXES_DIR) {}

  dir(id: string): string {
    return path.join(this.root, id);
  }

  async write(record: SandboxRecord): Promise<void> {
    const dir = this.dir(record.id);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, "record.json");
    await Bun.write(file, JSON.stringify(SandboxRecordSchema.parse(record)));
    await chmod(file, 0o600);
  }

  async read(id: string): Promise<SandboxRecord | null> {
    const file = Bun.file(path.join(this.dir(id), "record.json"));
    return (await file.exists())
      ? SandboxRecordSchema.parse(JSON.parse(await file.text()))
      : null;
  }

  async list(): Promise<SandboxRecord[]> {
    let entries: string[];
    try {
      entries = await readdir(this.root);
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return [];
      }
      throw error;
    }
    const records = await Promise.all(
      entries
        .filter((entry) => entry.startsWith("sbx-"))
        .map(async (entry) => this.read(entry)),
    );
    return records.filter((record) => record !== null);
  }

  async remove(id: string): Promise<void> {
    await rm(this.dir(id), { recursive: true, force: true });
  }
}
