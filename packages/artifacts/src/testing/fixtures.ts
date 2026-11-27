import type { TestRuntime } from "./runtime.ts";

export const TOKEN = "test-token-one-0000000000000000";
export const OTHER_TOKEN = "test-token-two-0000000000000000";
export const VERSION_ID = "11111111-1111-4111-8111-111111111111";

export type FixtureFile = { body: string | Uint8Array; mediaType: string };

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString(
    "hex",
  );
}

/** Registers a version with its files in the in-memory catalog and store. */
export async function publishFixture(
  runtime: TestRuntime,
  files: Record<string, FixtureFile>,
  options: {
    token?: string;
    kind?: string;
    entryPath?: string;
    versionId?: string;
  } = {},
) {
  const token = options.token ?? TOKEN;
  const versionId = options.versionId ?? VERSION_ID;
  const entries: Record<
    string,
    { sha256: string; size: number; storageKey: string; mediaType: string }
  > = {};
  for (const [path, file] of Object.entries(files)) {
    const bytes =
      typeof file.body === "string"
        ? new TextEncoder().encode(file.body)
        : new Uint8Array(file.body);
    const sha256 = await sha256Hex(bytes);
    const storageKey = `objects/${versionId}/${path}`;
    runtime.store.put(storageKey, bytes);
    entries[path] = {
      sha256,
      size: bytes.length,
      storageKey,
      mediaType: file.mediaType,
    };
  }
  runtime.catalog.addVersion(
    token,
    {
      versionId,
      artifactId: "22222222-2222-4222-8222-222222222222",
      kind: options.kind ?? "site",
      entryPath: options.entryPath ?? "index.html",
    },
    entries,
  );
  return { token, versionId, entries };
}
