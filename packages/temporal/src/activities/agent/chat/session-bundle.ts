import { lstat, mkdir, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { z } from "zod/v4";
import {
  AgentChatTurnResultSchema,
  type AgentChatProvider,
  type AgentChatTurnResult,
} from "#shared/agent/agent-chat.ts";
import {
  MAX_SESSION_BUNDLE_BYTES,
  SessionCheckpointSchema,
  pushSessionCheckpoint,
  pullSessionCheckpoint,
} from "./session-checkpoint.ts";
import type { AgentChatObjectStore } from "./session-store.ts";

const BundleFileSchema = SessionCheckpointSchema.safeExtend({
  path: z.string().min(1),
});

const AgentChatSessionManifestFields = {
  chatId: z.string().min(1),
  provider: z.enum(["claude", "codex"]),
  turnNumber: z.number().int().positive(),
  turnId: z.string().min(1),
  providerSessionId: z.string().min(1),
  workspacePath: z.string().min(1),
  files: z.array(BundleFileSchema).min(1).max(1000),
};

export const AgentChatSessionManifestSchema = z
  .discriminatedUnion("schemaVersion", [
    z.strictObject({
      schemaVersion: z.literal(2),
      ...AgentChatSessionManifestFields,
    }),
    z.strictObject({
      schemaVersion: z.literal(3),
      ...AgentChatSessionManifestFields,
      turnResult: AgentChatTurnResultSchema,
    }),
  ])
  .refine(
    (manifest) =>
      manifest.files.reduce((bytes, file) => bytes + file.bytes, 0) <=
      MAX_SESSION_BUNDLE_BYTES,
    { message: "Provider session bundle exceeds 256 MiB" },
  );
export type AgentChatSessionManifest = z.infer<
  typeof AgentChatSessionManifestSchema
>;

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

async function existingProviderFiles(
  targetPath: string,
  sessionHome: string,
  resolvedSessionHome: string,
): Promise<string[]> {
  try {
    return await existingFiles(targetPath, sessionHome, resolvedSessionHome);
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      "code" in error &&
      Reflect.get(error, "code") === "ENOENT"
    ) {
      return [];
    }
    throw error;
  }
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

export function agentChatSessionManifestKey(input: {
  prefix: string;
  chatId: string;
  turnNumber: number;
  turnId: string;
}): string {
  return `${turnRoot(input.prefix, input.chatId, input.turnNumber, input.turnId)}/manifest.json`;
}

export function agentChatProviderAdmissionKey(input: {
  prefix: string;
  chatId: string;
  turnNumber: number;
  turnId: string;
}): string {
  return `${turnRoot(input.prefix, input.chatId, input.turnNumber, input.turnId)}/provider-admitted`;
}

function sha256(bytes: Uint8Array): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(bytes);
  return hasher.digest("hex");
}

function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

async function jsonObject(
  store: AgentChatObjectStore,
  key: string,
): Promise<unknown> {
  return JSON.parse(new TextDecoder().decode(await store.get(key)));
}

function requireBundleBudget(bytes: number, fileCount: number): void {
  if (bytes > MAX_SESSION_BUNDLE_BYTES || fileCount >= 1000) {
    throw new Error("Provider session bundle exceeds its size limit");
  }
}

async function cleanupCreatedChunks(
  store: AgentChatObjectStore,
  keys: ReadonlySet<string>,
): Promise<unknown[]> {
  const errors: unknown[] = [];
  for (const key of keys) {
    try {
      await store.delete(key);
    } catch (error: unknown) {
      errors.push(error);
    }
  }
  return errors;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength &&
    left.every((value, index) => value === right[index])
  );
}

class AmbiguousManifestPublicationError extends Error {
  override readonly name = "AmbiguousManifestPublicationError";
}

async function publishManifest(input: {
  store: AgentChatObjectStore;
  key: string;
  body: Uint8Array;
}): Promise<void> {
  try {
    await input.store.put(input.key, input.body);
    return;
  } catch (publicationError: unknown) {
    // A lost PUT response is ambiguous: the manifest may already reference
    // these chunks. Preserve them unless absence is positively confirmed.
    let manifestExists: boolean;
    try {
      manifestExists = await input.store.has(input.key);
    } catch (verificationError: unknown) {
      throw new AmbiguousManifestPublicationError(
        "Session manifest publication status could not be verified",
        {
          cause: new AggregateError(
            [publicationError, verificationError],
            "Manifest publication and verification failed",
            { cause: publicationError },
          ),
        },
      );
    }
    if (!manifestExists) throw publicationError;
    let publishedBytes: Uint8Array;
    try {
      publishedBytes = await input.store.get(input.key);
    } catch (verificationError: unknown) {
      throw new AmbiguousManifestPublicationError(
        "Committed session manifest could not be verified",
        {
          cause: new AggregateError(
            [publicationError, verificationError],
            "Manifest publication and readback failed",
            { cause: publicationError },
          ),
        },
      );
    }
    if (!bytesEqual(publishedBytes, input.body)) {
      throw new AmbiguousManifestPublicationError(
        "Committed session manifest does not match the attempted publication",
        { cause: publicationError },
      );
    }
  }
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
  turnResult: AgentChatTurnResult;
}): Promise<{
  manifest: AgentChatSessionManifest;
  manifestKey: string;
}> {
  const files: AgentChatSessionManifest["files"] = [];
  const createdChunkKeys = new Set<string>();
  try {
    const resolvedSessionHome = await realpath(input.sessionHome);
    let bundleBytes = 0;
    for (const sliceRoot of providerSliceRoots(
      input.provider,
      input.sessionHome,
    )) {
      const paths = await existingProviderFiles(
        sliceRoot,
        input.sessionHome,
        resolvedSessionHome,
      );
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
        bundleBytes += file.size;
        requireBundleBudget(bundleBytes, files.length);
        const checkpoint = await pushSessionCheckpoint({
          store: input.store,
          filePath: resolvedFilePath,
          blobsPrefix: `${sessionRoot(input.prefix, input.chatId)}/blobs/`,
          forbiddenTokens: input.forbiddenTokens,
          onChunkCreated: (key) => createdChunkKeys.add(key),
        });
        files.push({
          path: relativePath,
          ...checkpoint,
        });
      }
    }
    const manifestKey = agentChatSessionManifestKey(input);
    const turnResult = AgentChatTurnResultSchema.parse(input.turnResult);
    if (
      turnResult.turnId !== input.turnId ||
      turnResult.turnNumber !== input.turnNumber ||
      turnResult.providerSessionId !== input.providerSessionId ||
      turnResult.sessionManifestKey !== manifestKey
    ) {
      throw new Error("Session manifest result does not match its turn");
    }
    const manifest = AgentChatSessionManifestSchema.parse({
      schemaVersion: 3,
      chatId: input.chatId,
      provider: input.provider,
      turnNumber: input.turnNumber,
      turnId: input.turnId,
      providerSessionId: input.providerSessionId,
      workspacePath: input.workspacePath,
      files,
      turnResult,
    });
    const manifestBytes = jsonBytes(manifest);
    await publishManifest({
      store: input.store,
      key: manifestKey,
      body: manifestBytes,
    });
    return { manifest, manifestKey };
  } catch (error: unknown) {
    if (error instanceof AmbiguousManifestPublicationError) throw error;
    const cleanupErrors = await cleanupCreatedChunks(
      input.store,
      createdChunkKeys,
    );
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        cleanupErrors,
        "Session bundle publication and orphan cleanup both failed",
        { cause: error },
      );
    }
    throw error;
  }
}

export async function recoverPublishedAgentChatTurn(input: {
  store: AgentChatObjectStore;
  prefix: string;
  chatId: string;
  provider: AgentChatProvider;
  turnNumber: number;
  turnId: string;
  workspacePath: string;
}): Promise<AgentChatTurnResult | undefined> {
  const manifestKey = agentChatSessionManifestKey(input);
  if (!(await input.store.has(manifestKey))) return undefined;
  const manifest = AgentChatSessionManifestSchema.parse(
    await jsonObject(input.store, manifestKey),
  );
  if (manifest.schemaVersion !== 3) {
    throw new Error("Published session manifest is missing its turn result");
  }
  const result = AgentChatTurnResultSchema.parse(manifest.turnResult);
  if (
    manifest.chatId !== input.chatId ||
    manifest.provider !== input.provider ||
    manifest.turnNumber !== input.turnNumber ||
    manifest.turnId !== input.turnId ||
    manifest.workspacePath !== input.workspacePath ||
    manifest.providerSessionId !== result.providerSessionId ||
    result.turnId !== input.turnId ||
    result.turnNumber !== input.turnNumber ||
    result.sessionManifestKey !== manifestKey
  ) {
    throw new Error("Published session manifest does not match its turn");
  }
  return result;
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

  for (const file of manifest.files) {
    if (EXCLUDED_BASENAMES.has(file.path.split("/").at(-1) ?? "")) {
      throw new Error(`Session bundle contains excluded file: ${file.path}`);
    }
    const destination = safeDestination(input.sessionHome, file.path);
    await mkdir(path.dirname(destination), { recursive: true });
    await pullSessionCheckpoint({
      store: input.store,
      checkpoint: {
        bytes: file.bytes,
        sha256: file.sha256,
        chunks: file.chunks,
      },
      destination,
      blobsPrefix: `${sessionRoot(input.prefix, input.chatId)}/blobs/`,
    });
  }
  return manifest;
}
