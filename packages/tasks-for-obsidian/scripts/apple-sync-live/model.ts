import { lstat, mkdir, readFile, realpath, rename } from "node:fs/promises";
import path from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { z } from "zod";
import { GuestExecutionSchema } from "./transport/contract";
import acceptanceDefinition from "@tasknotes/fixtures/schema/facet-acceptance.schema.json";
import { ArchiveLineageSchema } from "./reference-archive/contract";

export const packageRoot = path.resolve(import.meta.dir, "../..");

export const root = path.resolve(packageRoot, "../..");

export const fixtures = path.resolve(packageRoot, "../tasknotes-fixtures");

export const runs = path.join(packageRoot, ".build/live-sync");

export const iosBundle = "org.reactjs.native.example.TasksForObsidian";

export const macBundle = "red.sjer.tasknotes.mac.acceptance";

export const deviceType = "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro";
export const provenancePaths = [
  "bun.lock",
  ".mise.toml",
  "packages/tasknotes-core",
  "packages/tasknotes-macos",
  "packages/tasknotes-fixtures",
  "packages/tasks-for-obsidian/ios",
  "packages/tasks-for-obsidian/package.json",
  "packages/tasks-for-obsidian/scripts/apple-sync-live.ts",
  "packages/tasks-for-obsidian/scripts/apple-sync-live",
  "packages/tasks-for-obsidian/scripts/ios-account.ts",
  "packages/tasks-for-obsidian/scripts/ios-account",
  "packages/tasks-for-obsidian/scripts/native-acceptance",
];
export class PendingCheckpoint extends Error {}

export const uuid = z.uuid();

export const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);

export const clients = z.enum(["ios", "macos"]);

export type Client = z.infer<typeof clients>;

export const requiredCases = [
  "official-reference",
  "initial-download",
  "bidirectional-changes",
  "file-operations",
  "configuration",
  "offline-recovery",
  "concurrent-edits",
  "session-lifecycle",
  "authentication-failures",
  "official-ui",
  "binary-changes",
  "three-consecutive-runs",
] as const;

export const FileSchema = z.strictObject({
  size: z.number().int().nonnegative(),
  sha256,
});

export const ClientSchema = z.strictObject({
  container: z.string(),
  descriptor: z.string(),
  stateDirectory: z.string(),
});

const manifestFields = {
  runID: uuid,
  createdAt: z.iso.datetime(),
  round: z.number().int().min(1).max(3),
  failures: z.array(
    z.strictObject({
      round: z.number().int(),
      operation: z.string(),
      capturedAt: z.iso.datetime(),
    }),
  ),
  completedRounds: z.array(
    z.strictObject({ round: z.number().int(), evidenceSHA256: sha256 }),
  ),
  operations: z.record(z.string(), z.enum(["pass", "failed"])),
  stage: z.enum([
    "preparing",
    "owner-setup",
    "bound",
    "initial-verified",
    "failed",
    "cleaned",
  ]),
  allowedRemoteVaultID: z.string().min(1).max(256).nullable(),
  reference: z.record(z.string(), FileSchema),
  pluginFixtureSHA256: sha256,
  referenceArchive: ArchiveLineageSchema.optional(),
  cases: z.record(z.enum(requiredCases), z.enum(["pending", "pass", "failed"])),
};

export const ManifestSchema = z.discriminatedUnion("schemaVersion", [
  z.strictObject({
    ...manifestFields,
    schemaVersion: z.literal(1),
    simulator: z.strictObject({ id: uuid, name: z.string() }).nullable(),
    clients: z
      .strictObject({ ios: ClientSchema, macos: ClientSchema })
      .nullable(),
  }),
  z.strictObject({
    ...manifestFields,
    schemaVersion: z.literal(2),
    scope: z.literal("macos"),
    simulator: z.null(),
    clients: z.strictObject({ macos: ClientSchema }).nullable(),
  }),
  z
    .strictObject({
      ...manifestFields,
      schemaVersion: z.literal(3),
      scope: z.enum(["apple", "macos"]),
      execution: GuestExecutionSchema,
      simulator: z.strictObject({ id: uuid, name: z.string() }).nullable(),
      clients: z
        .union([
          z.strictObject({ macos: ClientSchema }),
          z.strictObject({ ios: ClientSchema, macos: ClientSchema }),
        ])
        .nullable(),
    })
    .superRefine((value, context) => {
      if (value.execution.guestRunID !== value.runID)
        context.addIssue({
          code: "custom",
          message: "Guest execution belongs to another run",
        });
      if (
        value.scope === "macos" &&
        (value.simulator !== null ||
          (value.clients !== null && "ios" in value.clients))
      )
        context.addIssue({
          code: "custom",
          message: "Mac-only guest scope contains iOS state",
        });
      if (
        value.scope === "apple" &&
        value.clients !== null &&
        !("ios" in value.clients)
      )
        context.addIssue({
          code: "custom",
          message: "Apple guest scope requires both native clients",
        });
    }),
]);

export type Manifest = z.infer<typeof ManifestSchema>;
export type ClientState = z.infer<typeof ClientSchema>;

export function activeClients(manifest: Manifest): Client[] {
  return hasIOS(manifest) ? ["ios", "macos"] : ["macos"];
}

export function hasIOS(manifest: Manifest): boolean {
  return (
    manifest.schemaVersion === 1 ||
    (manifest.schemaVersion === 3 && manifest.scope === "apple")
  );
}

export function clientState(manifest: Manifest, client: Client): ClientState {
  clients.parse(client);
  if (client === "ios" && !hasIOS(manifest))
    throw new Error("Client is not selected for this acceptance scope");
  if (manifest.clients === null) throw new Error("Apps are not prepared");
  if (client === "macos") return manifest.clients.macos;
  if (!("ios" in manifest.clients))
    throw new Error("Missing selected iOS client");
  return manifest.clients.ios;
}

export const StatusSchema = z.looseObject({
  schemaVersion: z.literal(1),
  runID: uuid,
  capturedAt: z.iso.datetime(),
  accountBusy: z.boolean(),
  accountStage: z.string(),
  profiles: z.array(
    z.looseObject({
      profileID: uuid,
      profileKind: z.enum(["local_folder", "obsidian_sync"]),
      remoteVaultID: z.string().nullable(),
      phase: z.string(),
      transport: z.string(),
      hostWorkPending: z.boolean(),
      durable: z
        .looseObject({
          schemaVersion: z.literal(1),
          profileId: uuid,
          profileKind: z.enum(["local_folder", "obsidian_sync"]),
          version: z.number().int().nonnegative(),
          initialSyncComplete: z.boolean(),
          pendingRemoteCount: z.number().int().nonnegative(),
          pendingUploadCount: z.number().int().nonnegative(),
          conflictCount: z.number().int().nonnegative(),
          pendingMutationCount: z.number().int().nonnegative(),
        })
        .nullable(),
    }),
  ),
});

export const contract = new Ajv2020({ strict: false, allErrors: true });
addFormats(contract);

export const acceptanceSchema = z
  .record(z.string(), z.unknown())
  .parse(acceptanceDefinition);

export const validators = new Map<
  string,
  ReturnType<typeof contract.compile>
>();

export function validate(definition: string, value: unknown): void {
  let validator = validators.get(definition);
  if (validator === undefined) {
    validator = contract.compile({
      ...acceptanceSchema,
      $ref: `#/$defs/${definition}`,
    });
    validators.set(definition, validator);
  }
  if (!validator(value))
    throw new Error(`Invalid acceptance ${definition} contract`);
}

export function settledProfile(
  value: unknown,
  runID: string,
  vaultID: string,
  now: number,
) {
  validate("status", value);
  const status = StatusSchema.parse(value);
  const age = now - Date.parse(status.capturedAt);
  if (status.runID.toLowerCase() !== runID.toLowerCase())
    throw new Error("Wrong acceptance run");
  if (age < -1000 || age > 5000) throw new Error("Stale acceptance status");
  const [profile, ...remaining] = status.profiles;
  if (profile === undefined || remaining.length > 0)
    throw new Error("Expected exactly one bound profile");
  if (
    profile.profileKind !== "obsidian_sync" ||
    profile.remoteVaultID !== vaultID
  )
    throw new Error("Wrong acceptance vault");
  const durable = profile.durable;
  if (
    durable?.profileId !== profile.profileID ||
    durable.profileKind !== "obsidian_sync"
  )
    throw new Error("Missing matching durable Sync projection");
  if (
    status.accountBusy ||
    profile.phase !== "synced" ||
    profile.transport !== "connected" ||
    profile.hostWorkPending ||
    !durable.initialSyncComplete ||
    durable.pendingRemoteCount !== 0 ||
    durable.pendingUploadCount !== 0 ||
    durable.conflictCount !== 0 ||
    durable.pendingMutationCount !== 0
  )
    throw new Error("Synchronization has not settled");
  return profile;
}

export function digest(bytes: Uint8Array | string): string {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

export async function verifyReplica(
  directory: string,
  expected: Record<string, z.infer<typeof FileSchema>>,
) {
  for (const [relative, fingerprint] of Object.entries(expected)) {
    if (
      path.isAbsolute(relative) ||
      relative
        .split("/")
        .some((part) => part === ".." || part === "." || part === "")
    )
      throw new Error("Unsafe expected vault path");
    const filename = path.join(directory, relative);
    const actualPath = await realpath(filename);
    const stat = await lstat(filename);
    if (actualPath !== filename || !stat.isFile())
      throw new Error("Unsafe vault file");
    const bytes = await readFile(filename);
    if (
      bytes.length !== fingerprint.size ||
      digest(bytes) !== fingerprint.sha256
    )
      throw new Error(`Replica mismatch: ${relative}`);
  }
  const actual = [
    ...new Bun.Glob("**/*").scanSync({
      cwd: directory,
      onlyFiles: true,
      dot: true,
    }),
  ]
    .filter(
      (entry) =>
        !entry.startsWith(".obsidian/") ||
        entry === ".obsidian/plugins/tasknotes/data.json",
    )
    .sort();
  if (JSON.stringify(actual) !== JSON.stringify(Object.keys(expected).sort()))
    throw new Error("Replica has missing or unexpected vault paths");
}

export function assertOwnedSimulator(
  runID: string,
  simulator: { id: string; name: string },
  available: unknown,
) {
  uuid.parse(runID);
  uuid.parse(simulator.id);
  if (simulator.name !== `Facet Live Sync ${runID}`)
    throw new Error("Refusing an unowned simulator target");
  const devices = z
    .object({
      devices: z.record(
        z.string(),
        z.array(z.object({ udid: uuid, name: z.string() })),
      ),
    })
    .parse(available);
  const matches = Object.values(devices.devices)
    .flat()
    .filter((entry) => entry.udid === simulator.id);
  if (matches.length !== 1 || matches[0]?.name !== simulator.name)
    throw new Error("Simulator ownership no longer matches");
}

export function runDirectory(runID: string): string {
  return path.join(runs, uuid.parse(runID).toLowerCase());
}

export async function atomicJSON(filename: string, value: unknown) {
  await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
  if ((await realpath(path.dirname(filename))) !== path.dirname(filename))
    throw new Error("Refusing symlinked acceptance directory");
  const temporary = `${filename}.${crypto.randomUUID()}.tmp`;
  await Bun.write(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temporary, filename);
}
