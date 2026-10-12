import { createHash } from "node:crypto";
import { Context } from "@temporalio/activity";
import { ApplicationFailure } from "@temporalio/common";
import {
  GetObjectCommand,
  HeadObjectCommand,
  NoSuchKey,
  NotFound,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { z } from "zod/v4";
import { rwfRecordingArchiveConfig } from "#config/rwf-recording-archive.ts";
import {
  decodeMarkers,
  encodeMarker,
  objectKey,
  RecordingRefSchema,
  RwfArchiveContract,
  type ArchiveMarker,
  type RecordingRef,
  type RwfArchiveResult,
} from "#shared/rwf-recording-archive.ts";
import {
  kubectl,
  run,
  type Command,
} from "#activities/homelab/mining-reset-kubectl.ts";

/**
 * Where finished recordings come from and where the archive's receipt goes.
 * The production source reads the Minecraft pod's data volume through
 * `kubectl exec`; tests replace it.
 */
export type RecordingSource = {
  /** Whether the server is up. A hibernated server is never woken to archive. */
  awake: () => Promise<boolean>;
  /** Finished recordings without a marker that matches them, oldest first. */
  unarchived: () => Promise<RecordingRef[]>;
  /** The recording's bytes. */
  read: (recording: RecordingRef) => Promise<Uint8Array>;
  /** Writes the marker that lets the plugin's retention delete the recording. */
  markArchived: (
    recording: RecordingRef,
    marker: ArchiveMarker,
  ) => Promise<void>;
};

/** What the object store holds under a key. */
export type StoredObject = { readonly sha256: string; readonly bytes: number };

/** The object store recordings are archived to. */
export type ArchiveStore = {
  /** The object's recorded SHA-256 and size, or undefined when there is none. */
  stat: (key: string) => Promise<StoredObject | undefined>;
  /** Stores `body` under `key`, recording its SHA-256. */
  put: (key: string, body: Uint8Array, sha256: string) => Promise<void>;
  /** Reads the object back and hashes what actually landed. */
  confirm: (key: string) => Promise<StoredObject>;
};

export type ArchiveDependencies = {
  readonly enabled: () => Promise<boolean>;
  readonly source: RecordingSource;
  readonly store: () => ArchiveStore;
  readonly heartbeat: (detail: string) => void;
};

export function sha256(body: Uint8Array): string {
  return createHash("sha256").update(body).digest("hex");
}

/**
 * Archives up to `limit` finished recordings. Each is read, hashed, stored
 * (unless an identical object is already there), read back and hashed again,
 * and only then marked archived on the server, so the plugin never deletes a
 * recording whose copy has not been confirmed. An object that already holds
 * different bytes is never overwritten: that is a contract failure and stops
 * the run.
 */
export async function archiveRwfRecordingsWithDependencies(
  limit: number,
  dependencies: ArchiveDependencies,
): Promise<RwfArchiveResult> {
  if (!(await dependencies.enabled())) {
    return { status: "disabled", archived: 0, remaining: 0 };
  }
  if (!(await dependencies.source.awake())) {
    return { status: "sleeping", archived: 0, remaining: 0 };
  }
  const pending = await dependencies.source.unarchived();
  const store = pending.length === 0 ? undefined : dependencies.store();
  let archived = 0;
  for (const recording of pending.slice(0, limit)) {
    if (store === undefined) break;
    dependencies.heartbeat(recording.path);
    const body = await dependencies.source.read(recording);
    if (body.byteLength !== recording.bytes) {
      throw ApplicationFailure.nonRetryable(
        `Finished recording ${recording.path} changed size while being archived`,
      );
    }
    const digest = sha256(body);
    const key = objectKey(recording.path);
    const existing = await store.stat(key);
    if (existing === undefined) {
      await store.put(key, body, digest);
    } else if (
      existing.sha256 !== digest ||
      existing.bytes !== body.byteLength
    ) {
      throw ApplicationFailure.nonRetryable(
        `Archive object ${key} already holds different bytes; refusing to overwrite`,
      );
    }
    const landed = await store.confirm(key);
    if (landed.sha256 !== digest || landed.bytes !== body.byteLength) {
      throw new Error(`Archive object ${key} did not read back as written`);
    }
    await dependencies.source.markArchived(recording, {
      key,
      sha256: digest,
      bytes: body.byteLength,
    });
    archived++;
  }
  return { status: "archived", archived, remaining: pending.length - archived };
}

const NAMESPACE = "minecraft-tsmc";
const POD = "minecraft-tsmc-0";
const CONTAINER = "minecraft-tsmc";
/** The plugin data folder inside the Minecraft container. */
export const RECORDINGS_ROOT = `/data/plugins/TheStorm/${RwfArchiveContract.directory}`;

const Server = z.object({
  spec: z.object({ replicas: z.number().int().nonnegative() }),
  status: z
    .object({ readyReplicas: z.number().int().nonnegative().optional() })
    .optional(),
});

function exec(command: Command, args: readonly string[], input?: string) {
  return run(
    command,
    [
      "--request-timeout=60s",
      "-n",
      NAMESPACE,
      "exec",
      ...(input === undefined ? [] : ["-i"]),
      POD,
      "-c",
      CONTAINER,
      "--",
      ...args,
    ],
    input,
  );
}

/** Parses `find -printf '%s\t%P\n'` lines into finished recordings. */
export function parseListing(text: string): RecordingRef[] {
  const recordings: RecordingRef[] = [];
  for (const line of text.split("\n")) {
    if (line === "") continue;
    const [bytes, path] = line.split("\t");
    const parsed = RecordingRefSchema.safeParse({
      path,
      bytes: Number(bytes),
    });
    // Anything else in the folder (a .part still being written, a marker, a
    // stray file) is not a finished recording.
    if (parsed.success) recordings.push(parsed.data);
  }
  return recordings.toSorted((a, b) => a.path.localeCompare(b.path));
}

/** The recordings whose marker is missing or does not match their size. */
export function withoutMatchingMarker(
  recordings: readonly RecordingRef[],
  markers: readonly ArchiveMarker[],
): RecordingRef[] {
  const byKey = new Map(markers.map((marker) => [marker.key, marker]));
  return recordings.filter(
    (recording) =>
      byKey.get(objectKey(recording.path))?.bytes !== recording.bytes,
  );
}

/** The production source: `kubectl exec` into the running Minecraft pod. */
export function kubectlRecordingSource(command: Command): RecordingSource {
  return {
    async awake() {
      const server = Server.parse(
        JSON.parse(
          await run(command, [
            "--request-timeout=15s",
            "-n",
            NAMESPACE,
            "get",
            "statefulset",
            NAMESPACE,
            "-o",
            "json",
          ]),
        ),
      );
      return (
        server.spec.replicas > 0 && (server.status?.readyReplicas ?? 0) > 0
      );
    },
    async unarchived() {
      const listing = await exec(command, [
        "find",
        RECORDINGS_ROOT,
        "-type",
        "f",
        "-name",
        `*${RwfArchiveContract.recordingSuffix}`,
        "-printf",
        String.raw`%s\t%P\n`,
      ]);
      const markers = await exec(command, [
        "find",
        RECORDINGS_ROOT,
        "-type",
        "f",
        "-name",
        `*${RwfArchiveContract.recordingSuffix}${RwfArchiveContract.markerSuffix}`,
        "-exec",
        "cat",
        "{}",
        "+",
      ]);
      return withoutMatchingMarker(
        parseListing(listing),
        decodeMarkers(markers),
      );
    },
    async read(recording) {
      const encoded = await exec(command, [
        "base64",
        "-w",
        "0",
        `${RECORDINGS_ROOT}/${RecordingRefSchema.parse(recording).path}`,
      ]);
      return new Uint8Array(Buffer.from(encoded.trim(), "base64"));
    },
    async markArchived(recording, marker) {
      const target = `${RECORDINGS_ROOT}/${RecordingRefSchema.parse(recording).path}${RwfArchiveContract.markerSuffix}`;
      // Written beside the recording and renamed into place, so the plugin
      // never reads half a marker. The path travels as an argument, never as
      // shell text.
      await exec(
        command,
        ["sh", "-c", 'cat > "$1.tmp" && mv -f "$1.tmp" "$1"', "sh", target],
        encodeMarker(marker),
      );
    },
  };
}

function requiredEnv(name: string): string {
  const value = Bun.env[name];
  if (value === undefined || value === "") {
    throw ApplicationFailure.nonRetryable(
      `${name} is required to archive Red Warfare recordings`,
    );
  }
  return value;
}

/** The production store: an S3-compatible bucket (SeaweedFS in the homelab). */
export function s3ArchiveStore(): ArchiveStore {
  const bucket = requiredEnv("RWF_ARCHIVE_S3_BUCKET");
  const client = new S3Client({
    endpoint: requiredEnv("RWF_ARCHIVE_S3_ENDPOINT"),
    region: Bun.env["RWF_ARCHIVE_S3_REGION"] ?? "us-east-1",
    forcePathStyle: true,
    credentials: {
      accessKeyId: requiredEnv("RWF_ARCHIVE_S3_ACCESS_KEY_ID"),
      secretAccessKey: requiredEnv("RWF_ARCHIVE_S3_SECRET_ACCESS_KEY"),
    },
  });
  return {
    async stat(key) {
      try {
        const head = await client.send(
          new HeadObjectCommand({ Bucket: bucket, Key: key }),
        );
        return {
          sha256: head.Metadata?.["sha256"] ?? "",
          bytes: head.ContentLength ?? -1,
        };
      } catch (error: unknown) {
        if (error instanceof NotFound || error instanceof NoSuchKey) return;
        throw error;
      }
    },
    async put(key, body, digest) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: "application/gzip",
          Metadata: { sha256: digest },
        }),
      );
    },
    async confirm(key) {
      const response = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
      );
      if (response.Body === undefined)
        throw new Error(`Archive object ${key} has no body`);
      const body = await response.Body.transformToByteArray();
      return { sha256: sha256(body), bytes: body.byteLength };
    },
  };
}

export const rwfRecordingArchiveActivities = {
  async archiveRwfRecordings(limit: number): Promise<RwfArchiveResult> {
    return archiveRwfRecordingsWithDependencies(limit, {
      enabled: async () => {
        const config = await rwfRecordingArchiveConfig();
        return config.enabled;
      },
      source: kubectlRecordingSource(kubectl),
      store: s3ArchiveStore,
      heartbeat: (detail) => {
        Context.current().heartbeat({ recording: detail });
      },
    });
  },
};
export type RwfRecordingArchiveActivities =
  typeof rwfRecordingArchiveActivities;
