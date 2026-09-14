// Session-slice push/pull against SeaweedFS S3. Mirrors the planned production
// layout (per-file objects + manifest + latest pointer) at spike fidelity.
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { readdir, mkdir } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod/v4";

const ManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  sessionId: z.string().min(1),
  provider: z.enum(["codex", "claude"]),
  turn: z.number().int().nonnegative(),
  providerSessionId: z.string().min(1),
  workspacePath: z.string().min(1),
  files: z
    .array(
      z.strictObject({
        path: z.string().min(1),
        key: z.string().min(1),
        bytes: z.number().int().nonnegative(),
      }),
    )
    .min(1),
});
export type Manifest = z.infer<typeof ManifestSchema>;

const LatestSchema = z.strictObject({
  turn: z.number().int().nonnegative(),
  manifestKey: z.string().min(1),
});

function requiredEnv(name: string): string {
  const value = Bun.env[name];
  if (value === undefined || value === "")
    throw new Error(`missing env: ${name}`);
  return value;
}

export function makeClient(): {
  client: S3Client;
  bucket: string;
  prefix: string;
} {
  const client = new S3Client({
    endpoint: requiredEnv("SPIKE_S3_ENDPOINT"),
    region: "us-east-1",
    forcePathStyle: true,
    credentials: {
      accessKeyId: requiredEnv("AWS_ACCESS_KEY_ID"),
      secretAccessKey: requiredEnv("AWS_SECRET_ACCESS_KEY"),
    },
  });
  return {
    client,
    bucket: requiredEnv("SPIKE_S3_BUCKET"),
    prefix: requiredEnv("SPIKE_S3_PREFIX"),
  };
}

async function walkFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(root, { withFileTypes: true, recursive: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    out.push(join(entry.parentPath, entry.name));
  }
  return out.sort();
}

// Slice roots relative to SESSION_HOME, per provider.
export function sliceRoots(
  provider: "codex" | "claude",
  sessionHome: string,
): string[] {
  if (provider === "codex") {
    return [
      join(sessionHome, "codex-home", "sessions"),
      join(sessionHome, "codex-home", "history.jsonl"),
    ];
  }
  return [
    join(sessionHome, "home", ".claude", "projects"),
    join(sessionHome, "home", ".claude.json"),
  ];
}

const EXCLUDED_BASENAMES = new Set([
  "auth.json",
  "config.toml",
  ".credentials.json",
]);

export async function pushSlice(input: {
  provider: "codex" | "claude";
  sessionId: string;
  turn: number;
  providerSessionId: string;
  workspacePath: string;
  sessionHome: string;
}): Promise<void> {
  const { client, bucket, prefix } = makeClient();
  const files: Manifest["files"] = [];
  for (const root of sliceRoots(input.provider, input.sessionHome)) {
    const rootStat = await Bun.file(root)
      .exists()
      .catch(() => false);
    const isDir = await readdir(root)
      .then(() => true)
      .catch(() => false);
    const paths = isDir ? await walkFiles(root) : rootStat ? [root] : [];
    for (const path of paths) {
      if (EXCLUDED_BASENAMES.has(path.split("/").at(-1) ?? "")) continue;
      const rel = relative(input.sessionHome, path);
      const key = `${prefix}/sessions/${input.sessionId}/turns/${input.turn}/files/${rel}`;
      const body = new Uint8Array(await Bun.file(path).arrayBuffer());
      await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: body }),
      );
      files.push({ path: rel, key, bytes: body.byteLength });
    }
  }
  if (files.length === 0)
    throw new Error(`no session files found to push for ${input.provider}`);
  const manifest: Manifest = {
    schemaVersion: 1,
    sessionId: input.sessionId,
    provider: input.provider,
    turn: input.turn,
    providerSessionId: input.providerSessionId,
    workspacePath: input.workspacePath,
    files,
  };
  const manifestKey = `${prefix}/sessions/${input.sessionId}/turns/${input.turn}/manifest.json`;
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: manifestKey,
      Body: JSON.stringify(manifest, null, 2),
    }),
  );
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: `${prefix}/sessions/${input.sessionId}/latest.json`,
      Body: JSON.stringify({ turn: input.turn, manifestKey } satisfies z.infer<
        typeof LatestSchema
      >),
    }),
  );
  console.error(
    `[bundle] pushed ${files.length} files for session ${input.sessionId} turn ${input.turn}`,
  );
}

async function getJson(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<unknown> {
  const res = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  const text = await res.Body?.transformToString();
  if (text === undefined) throw new Error(`empty object: ${key}`);
  return JSON.parse(text);
}

export async function deleteSession(sessionId: string): Promise<void> {
  const { client, bucket, prefix } = makeClient();
  const root = `${prefix}/sessions/${sessionId}/`;
  let token: string | undefined;
  do {
    const listed = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: root,
        ContinuationToken: token,
      }),
    );
    const keys = (listed.Contents ?? []).flatMap((o) =>
      o.Key === undefined ? [] : [{ Key: o.Key }],
    );
    if (keys.length > 0) {
      await client.send(
        new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys } }),
      );
    }
    token =
      listed.IsTruncated === true ? listed.NextContinuationToken : undefined;
  } while (token !== undefined);
  console.error(`[bundle] deleted session ${sessionId} objects under ${root}`);
}

export async function pullLatest(
  sessionId: string,
  sessionHome: string,
): Promise<Manifest> {
  const { client, bucket, prefix } = makeClient();
  const latest = LatestSchema.parse(
    await getJson(
      client,
      bucket,
      `${prefix}/sessions/${sessionId}/latest.json`,
    ),
  );
  const manifest = ManifestSchema.parse(
    await getJson(client, bucket, latest.manifestKey),
  );
  const sessionPrefix = `${prefix}/sessions/${sessionId}/`;
  const manifestKey = `${sessionPrefix}turns/${latest.turn}/manifest.json`;
  if (latest.manifestKey !== manifestKey) {
    throw new Error(`manifest pointer outside session: ${latest.manifestKey}`);
  }
  if (manifest.sessionId !== sessionId || manifest.turn !== latest.turn) {
    throw new Error("manifest does not match the requested session turn");
  }
  for (const file of manifest.files) {
    if (EXCLUDED_BASENAMES.has(file.path.split("/").at(-1) ?? "")) {
      throw new Error(`session bundle contains excluded file: ${file.path}`);
    }
    if (isAbsolute(file.path) || file.path.includes("\\")) {
      throw new Error(`session bundle path is not relative: ${file.path}`);
    }
    const dest = resolve(sessionHome, file.path);
    const escaped = relative(sessionHome, dest);
    if (
      escaped === ".." ||
      escaped.startsWith(`..${sep}`) ||
      isAbsolute(escaped)
    ) {
      throw new Error(`session bundle path escapes session home: ${file.path}`);
    }
    const filesPrefix = `${sessionPrefix}turns/${manifest.turn}/files/`;
    if (file.key !== `${filesPrefix}${file.path}`) {
      throw new Error(`session bundle key does not match path: ${file.path}`);
    }
    const res = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: file.key }),
    );
    const bytes = await res.Body?.transformToByteArray();
    if (bytes === undefined) throw new Error(`empty object: ${file.key}`);
    await mkdir(dirname(dest), { recursive: true });
    if (bytes.byteLength !== file.bytes) {
      throw new Error(`session bundle byte count mismatch: ${file.path}`);
    }
    await Bun.write(dest, bytes);
  }
  console.error(
    `[bundle] hydrated ${manifest.files.length} files for session ${sessionId} (turn ${manifest.turn})`,
  );
  return manifest;
}
