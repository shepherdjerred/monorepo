import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { lstat, mkdir, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { z } from "zod/v4";
import type { AgentChatProvider } from "#shared/agent/agent-chat.ts";

const BundleFileSchema = z.strictObject({
  path: z.string().min(1),
  key: z.string().min(1),
  bytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f\d]{64}$/),
});

export const AgentChatSessionManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  chatId: z.string().min(1),
  provider: z.enum(["claude", "codex"]),
  turnNumber: z.number().int().positive(),
  turnId: z.string().min(1),
  providerSessionId: z.string().min(1),
  workspacePath: z.string().min(1),
  files: z.array(BundleFileSchema).min(1),
});
export type AgentChatSessionManifest = z.infer<
  typeof AgentChatSessionManifestSchema
>;

export type AgentChatObjectStore = {
  get: (key: string) => Promise<Uint8Array>;
  put: (key: string, body: Uint8Array) => Promise<void>;
};

export function createAgentChatS3Store(input: {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}): AgentChatObjectStore {
  const client = new S3Client({
    endpoint: input.endpoint,
    region: input.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: input.accessKeyId,
      secretAccessKey: input.secretAccessKey,
    },
  });
  return {
    get: async (key) => {
      const response = await client.send(
        new GetObjectCommand({ Bucket: input.bucket, Key: key }),
      );
      const bytes = await response.Body?.transformToByteArray();
      if (bytes === undefined) throw new Error(`Empty session object: ${key}`);
      return bytes;
    },
    put: async (key, body) => {
      await client.send(
        new PutObjectCommand({ Bucket: input.bucket, Key: key, Body: body }),
      );
    },
  };
}

function providerSliceRoots(
  provider: AgentChatProvider,
  sessionHome: string,
): readonly string[] {
  return provider === "codex"
    ? [
        path.join(sessionHome, "codex-home", "sessions"),
        path.join(sessionHome, "codex-home", "history.jsonl"),
      ]
    : [path.join(sessionHome, "home", ".claude", "projects")];
}

const EXCLUDED_BASENAMES = new Set([
  "auth.json",
  "config.toml",
  ".credentials.json",
]);

function assertWithinSessionHome(
  sessionHome: string,
  resolvedPath: string,
): void {
  const relativePath = path.relative(sessionHome, resolvedPath);
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(
      `Provider session path escapes session home: ${resolvedPath}`,
    );
  }
}

async function rejectSymbolicLinkComponents(
  sessionHome: string,
  candidatePath: string,
): Promise<void> {
  const relativePath = path.relative(sessionHome, candidatePath);
  assertWithinSessionHome(sessionHome, path.resolve(candidatePath));
  let currentPath = sessionHome;
  for (const component of relativePath.split(path.sep)) {
    if (component === "") continue;
    currentPath = path.join(currentPath, component);
    const metadata = await lstat(currentPath);
    if (metadata.isSymbolicLink()) {
      throw new Error(
        `Provider session path is a symbolic link: ${currentPath}`,
      );
    }
  }
}

async function existingFiles(
  targetPath: string,
  sessionHome: string,
  resolvedSessionHome: string,
): Promise<string[]> {
  await rejectSymbolicLinkComponents(sessionHome, targetPath);
  const target = await lstat(targetPath);
  assertWithinSessionHome(resolvedSessionHome, await realpath(targetPath));
  if (target.isFile()) return [targetPath];
  const entries = await readdir(targetPath, {
    withFileTypes: true,
    recursive: true,
  });
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(entry.parentPath, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Provider session path is a symbolic link: ${entryPath}`);
    }
    if (entry.isFile()) files.push(entryPath);
  }
  return files.sort();
}

function sessionRoot(prefix: string, chatId: string): string {
  return `${prefix}/sessions/${chatId}`;
}

function turnRoot(
  prefix: string,
  chatId: string,
  turnNumber: number,
  turnId: string,
): string {
  return `${sessionRoot(prefix, chatId)}/turns/${String(turnNumber)}/attempts/${sha256(new TextEncoder().encode(turnId))}`;
}

function sha256(bytes: Uint8Array): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(bytes);
  return hasher.digest("hex");
}

function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function containsBytes(contents: Uint8Array, candidate: Uint8Array): boolean {
  if (
    candidate.byteLength === 0 ||
    candidate.byteLength > contents.byteLength
  ) {
    return false;
  }
  const finalOffset = contents.byteLength - candidate.byteLength;
  for (let offset = 0; offset <= finalOffset; offset += 1) {
    let matches = true;
    for (let index = 0; index < candidate.byteLength; index += 1) {
      if (contents[offset + index] !== candidate[index]) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }
  return false;
}

function rejectForbiddenSessionContents(
  contents: Uint8Array,
  forbiddenTokens: readonly string[],
): void {
  const encoder = new TextEncoder();
  for (const token of forbiddenTokens) {
    if (containsBytes(contents, encoder.encode(token))) {
      throw new Error(
        "Provider session state contains a mounted credential and cannot be persisted",
      );
    }
  }
}

async function jsonObject(
  store: AgentChatObjectStore,
  key: string,
): Promise<unknown> {
  return JSON.parse(new TextDecoder().decode(await store.get(key)));
}

export async function pushAgentChatSessionBundle(input: {
  store: AgentChatObjectStore;
  prefix: string;
  chatId: string;
  provider: AgentChatProvider;
  turnNumber: number;
  turnId: string;
  providerSessionId: string;
  workspacePath: string;
  sessionHome: string;
  forbiddenTokens: readonly string[];
}): Promise<{
  manifest: AgentChatSessionManifest;
  manifestKey: string;
}> {
  const files: AgentChatSessionManifest["files"] = [];
  const root = turnRoot(
    input.prefix,
    input.chatId,
    input.turnNumber,
    input.turnId,
  );
  const resolvedSessionHome = await realpath(input.sessionHome);
  for (const sliceRoot of providerSliceRoots(
    input.provider,
    input.sessionHome,
  )) {
    let paths: string[];
    try {
      paths = await existingFiles(
        sliceRoot,
        input.sessionHome,
        resolvedSessionHome,
      );
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        "code" in error &&
        Reflect.get(error, "code") === "ENOENT"
      ) {
        continue;
      }
      throw error;
    }
    for (const filePath of paths) {
      if (EXCLUDED_BASENAMES.has(filePath.split(path.sep).at(-1) ?? "")) {
        continue;
      }
      await rejectSymbolicLinkComponents(input.sessionHome, filePath);
      const file = await lstat(filePath);
      if (file.isSymbolicLink() || !file.isFile()) {
        throw new Error(
          `Provider session file is not a regular file: ${filePath}`,
        );
      }
      const resolvedFilePath = await realpath(filePath);
      assertWithinSessionHome(resolvedSessionHome, resolvedFilePath);
      const relativePath = path.relative(input.sessionHome, filePath);
      const key = `${root}/files/${relativePath}`;
      const buffer = await Bun.file(resolvedFilePath).arrayBuffer();
      const body = new Uint8Array(buffer);
      rejectForbiddenSessionContents(body, input.forbiddenTokens);
      await input.store.put(key, body);
      files.push({
        path: relativePath,
        key,
        bytes: body.byteLength,
        sha256: sha256(body),
      });
    }
  }
  const manifest = AgentChatSessionManifestSchema.parse({
    schemaVersion: 1,
    chatId: input.chatId,
    provider: input.provider,
    turnNumber: input.turnNumber,
    turnId: input.turnId,
    providerSessionId: input.providerSessionId,
    workspacePath: input.workspacePath,
    files,
  });
  const manifestKey = `${root}/manifest.json`;
  await input.store.put(manifestKey, jsonBytes(manifest));
  return { manifest, manifestKey };
}

function safeDestination(sessionHome: string, pathname: string): string {
  if (path.isAbsolute(pathname) || pathname.includes("\\")) {
    throw new Error(`Session bundle path is not relative: ${pathname}`);
  }
  const destination = path.resolve(sessionHome, pathname);
  const escaped = path.relative(sessionHome, destination);
  if (
    escaped === ".." ||
    escaped.startsWith(`..${path.sep}`) ||
    path.isAbsolute(escaped)
  ) {
    throw new Error(`Session bundle path escapes session home: ${pathname}`);
  }
  return destination;
}

export async function pullLatestAgentChatSessionBundle(input: {
  store: AgentChatObjectStore;
  prefix: string;
  chatId: string;
  provider: AgentChatProvider;
  providerSessionId: string;
  manifestKey: string;
  expectedTurnNumber: number;
  workspacePath: string;
  sessionHome: string;
}): Promise<AgentChatSessionManifest> {
  const expectedPrefix = `${sessionRoot(input.prefix, input.chatId)}/turns/${String(input.expectedTurnNumber)}/attempts/`;
  if (
    !input.manifestKey.startsWith(expectedPrefix) ||
    !input.manifestKey.endsWith("/manifest.json")
  ) {
    throw new Error("Session manifest pointer is outside the requested chat");
  }
  const manifest = AgentChatSessionManifestSchema.parse(
    await jsonObject(input.store, input.manifestKey),
  );
  const expectedManifestKey = `${turnRoot(
    input.prefix,
    input.chatId,
    input.expectedTurnNumber,
    manifest.turnId,
  )}/manifest.json`;
  if (input.manifestKey !== expectedManifestKey) {
    throw new Error("Session manifest pointer does not match its turn id");
  }
  if (
    manifest.chatId !== input.chatId ||
    manifest.provider !== input.provider ||
    manifest.providerSessionId !== input.providerSessionId ||
    manifest.workspacePath !== input.workspacePath ||
    manifest.turnNumber !== input.expectedTurnNumber
  ) {
    throw new Error("Session manifest does not match the requested chat");
  }

  const filesPrefix = input.manifestKey.replace(/manifest\.json$/, "files/");
  for (const file of manifest.files) {
    if (EXCLUDED_BASENAMES.has(file.path.split("/").at(-1) ?? "")) {
      throw new Error(`Session bundle contains excluded file: ${file.path}`);
    }
    if (file.key !== `${filesPrefix}${file.path}`) {
      throw new Error(`Session bundle key does not match path: ${file.path}`);
    }
    const destination = safeDestination(input.sessionHome, file.path);
    const bytes = await input.store.get(file.key);
    if (bytes.byteLength !== file.bytes || sha256(bytes) !== file.sha256) {
      throw new Error(`Session bundle integrity check failed: ${file.path}`);
    }
    await mkdir(path.dirname(destination), { recursive: true });
    await Bun.write(destination, bytes);
  }
  return manifest;
}
