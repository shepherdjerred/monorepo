import { chmod, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  SandboxSummarySchema,
  type ProviderKind,
  type SandboxSummary,
} from "#protocol/ipc.ts";
import { SANDBOXES_DIR } from "#protocol/paths.ts";

/** How the provider that created a sandbox finds it again. */
export const ProviderRefSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("docker"),
    containerId: z.string().min(12),
  }),
  z.strictObject({
    kind: z.literal("kubernetes"),
    context: z.string().min(1),
    namespace: z.string().min(1),
    pod: z.string().min(1),
  }),
]);
export type ProviderRef = z.infer<typeof ProviderRefSchema>;

const RecordShapeSchema = SandboxSummarySchema.extend({
  providerRef: ProviderRefSchema,
  owner: z.string(),
  secrets: z.strictObject({
    bridgeToken: z.string().regex(/^[0-9a-f]{48}$/u),
    rconPassword: z.string().regex(/^[0-9a-f]{48}$/u),
  }),
}).refine((record) => record.providerRef.kind === record.provider, {
  message: "providerRef.kind must match provider",
});

/**
 * Records written before Kubernetes sandboxes kept a top-level Docker
 * `containerId`; read them as a Docker providerRef. New records never carry it.
 */
function migrateLegacyRecord(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || !("containerId" in raw)) {
    return raw;
  }
  const { containerId, ...rest } = raw;
  return "providerRef" in rest
    ? raw
    : { ...rest, providerRef: { kind: "docker", containerId } };
}

/**
 * A sandbox as the daemon persists it. This is the only place the bridge token
 * and RCON password live outside the server; the file is written 0600 and
 * never returned over IPC (see `toSummary`).
 */
export const SandboxRecordSchema = z.preprocess(
  migrateLegacyRecord,
  RecordShapeSchema,
);
export type SandboxRecord = z.infer<typeof RecordShapeSchema>;

/** The Docker container id of a Docker sandbox; fails loudly for any other. */
export function dockerContainerId(record: SandboxRecord): string {
  if (record.providerRef.kind !== "docker") {
    throw new Error(`Sandbox ${record.id} is not a Docker sandbox`);
  }
  return record.providerRef.containerId;
}

/** The pod of a Kubernetes sandbox; fails loudly for any other. */
export function kubernetesPod(
  record: SandboxRecord,
): Extract<ProviderRef, { kind: "kubernetes" }> {
  if (record.providerRef.kind !== "kubernetes") {
    throw new Error(`Sandbox ${record.id} is not a Kubernetes sandbox`);
  }
  return record.providerRef;
}

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

  /** Records of one provider; the other provider's records are not its to touch. */
  async listFor(provider: ProviderKind): Promise<SandboxRecord[]> {
    const records = await this.list();
    return records.filter((record) => record.provider === provider);
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
