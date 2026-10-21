import { z } from "zod";
import { PlatformReleaseSnapshotSchema } from "@shepherdjerred/delivery/contract";
import type { DeploymentDetail } from "@shepherdjerred/delivery/contract";
import {
  DeliveryJobArchiveSchema,
  type DeliveryJobArchive,
} from "#shared/delivery-job.ts";

const TofuSnapshotSchema = PlatformReleaseSnapshotSchema.refine(
  (snapshot) => snapshot.kind !== "root-release",
  "Tofu Jobs accept only plan and apply snapshots",
);
export type TofuSnapshot = Extract<
  z.infer<typeof PlatformReleaseSnapshotSchema>,
  { kind: "tofu-plan" | "tofu-apply" }
>;

/**
 * A Tofu Job input is the bare frozen snapshot (source checkout mode) or the
 * snapshot wrapped with the stack archive it runs from (X8). Both shapes are
 * explicit; nothing else is accepted.
 */
export const TofuJobInputSchema = z.union([
  z
    .object({ snapshot: TofuSnapshotSchema, archive: DeliveryJobArchiveSchema })
    .strict(),
  TofuSnapshotSchema.transform((snapshot) => ({
    snapshot,
    archive: undefined,
  })),
]);
export type TofuJobInput = {
  snapshot: TofuSnapshot;
  archive: DeliveryJobArchive | undefined;
};

export function tofuJobInput(raw: unknown): TofuJobInput {
  const parsed = TofuJobInputSchema.parse(raw);
  const snapshot: TofuSnapshot = parsed.snapshot;
  return { snapshot, archive: parsed.archive };
}

/** The component that carries a stack's archive once CI produces it (X8). */
export function tofuArchiveComponent(stack: string) {
  return `archive:tofu-${stack}`;
}

/** Wraps the frozen snapshot with the selected stack archive when the set revision carries one. */
export function tofuJobInputFor(
  detail: Pick<DeploymentDetail, "versionSet">,
  snapshot: TofuSnapshot,
): TofuJobInput {
  const artifact =
    detail.versionSet.components[tofuArchiveComponent(snapshot.stack)];
  if (artifact === undefined) return { snapshot, archive: undefined };
  if (artifact.kind !== "archive")
    throw new Error(
      `Component ${tofuArchiveComponent(snapshot.stack)} is not an archive artifact`,
    );
  return {
    snapshot,
    archive: DeliveryJobArchiveSchema.parse({
      uri: artifact.uri,
      digest: artifact.digest,
    }),
  };
}

/** The wire shape placed in a Job request: bare snapshot without an archive, wrapped with one. */
export function tofuJobRequestInput(input: TofuJobInput): unknown {
  return input.archive === undefined
    ? input.snapshot
    : { snapshot: input.snapshot, archive: input.archive };
}

/** Where the bootstrap extracted the verified archive; absent in source checkout mode. */
export function tofuStackDirectory(
  input: TofuJobInput,
  env: Record<string, string | undefined> = Bun.env,
): string | undefined {
  if (input.archive === undefined) return undefined;
  const directory = env["DELIVERY_STACK_ARCHIVE_DIR"];
  if (directory === undefined || directory === "")
    throw new Error(
      "Archive-mode Tofu Job is missing its extracted stack directory",
    );
  return directory;
}

/** The marker every apply writes next to the state so the target can be read back to its deployment (T5). */
export const TofuStateMarkerSchema = z
  .object({
    schema: z.literal("delivery-tofu-marker/v1"),
    deploymentId: z.string().min(1),
    stack: z.string().min(1),
    stateLineage: z.string().min(1),
    stateSerial: z.number().int().nonnegative(),
    archiveDigest: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/u)
      .nullable(),
    appliedAt: z.iso.datetime(),
  })
  .strict();
export type TofuStateMarker = z.infer<typeof TofuStateMarkerSchema>;
export const TOFU_STATE_BUCKET = "homelab-tofu-state";
export function tofuStateMarkerKey(stack: string) {
  return `${stack}/delivery-marker.json`;
}

export type MarkerStore = {
  write: (key: string, body: string) => Promise<void>;
  read: (key: string) => Promise<string>;
};
/** Writes the marker and reads it back byte-for-byte; a mismatch fails the apply. */
export async function writeTofuStateMarker(
  store: MarkerStore,
  marker: TofuStateMarker,
): Promise<TofuStateMarker> {
  const key = tofuStateMarkerKey(marker.stack);
  const body = JSON.stringify(TofuStateMarkerSchema.parse(marker));
  await store.write(key, body);
  const observed = await store.read(key);
  if (observed !== body)
    throw new Error("Tofu state marker readback differs from what was written");
  return marker;
}

/** The state bucket client built from the same credentials the stack's backend uses. */
export function stateMarkerStore(
  env: Record<string, string | undefined> = Bun.env,
): MarkerStore {
  const accessKeyId = z
    .string()
    .min(1)
    .parse(env["SEAWEEDFS_TOFU_STATE_ACCESS_KEY_ID"]);
  const secretAccessKey = z
    .string()
    .min(1)
    .parse(env["SEAWEEDFS_TOFU_STATE_SECRET_ACCESS_KEY"]);
  const client = new Bun.S3Client({
    accessKeyId,
    secretAccessKey,
    endpoint: "https://seaweedfs-s3.tailnet-1a49.ts.net",
    bucket: TOFU_STATE_BUCKET,
    region: "us-east-1",
  });
  return {
    write: async (key, body) => {
      await client.write(key, body, { type: "application/json" });
    },
    read: async (key) => await client.file(key).text(),
  };
}
