import {
  ReplayRenderPackageManifestSchema,
  type ReplayRenderPackageManifest,
} from "@scout-for-lol/domain/artifacts/replay-support.ts";
import type { ReplayResources } from "./engine.ts";
import { ReplayCapabilityError } from "./types.ts";

export async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function download(
  url: URL,
  signal: AbortSignal,
  maximumBytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  signal.throwIfAborted();
  const response = await fetch(url, {
    signal,
    credentials: "omit",
    redirect: "error",
  });
  if (response.status !== 200)
    throw new ReplayCapabilityError(
      "invalid-package",
      `Replay resource returned HTTP ${String(response.status)}`,
    );
  const declaredLength = response.headers.get("Content-Length");
  if (
    declaredLength !== null &&
    (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maximumBytes)
  ) {
    await response.body?.cancel();
    throw new ReplayCapabilityError(
      "invalid-package",
      "Replay resource exceeds its declared byte limit",
    );
  }
  if (!response.body)
    throw new ReplayCapabilityError(
      "invalid-package",
      "Replay resource has no response body",
    );
  const reader = response.body.getReader();
  const cancel = async () => {
    try {
      await reader.cancel(signal.reason);
    } catch {
      /* The active read reports the original abort or stream failure. */
    }
  };
  const cancelReader = () => {
    void cancel();
  };
  signal.addEventListener("abort", cancelReader, { once: true });
  let total = 0;
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  try {
    for (;;) {
      signal.throwIfAborted();
      const next = await reader.read();
      signal.throwIfAborted();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new ReplayCapabilityError(
          "invalid-package",
          "Replay resource exceeds its declared byte limit",
        );
      }
      chunks.push(next.value);
    }
  } finally {
    signal.removeEventListener("abort", cancelReader);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function loadVerifiedManifest(
  url: URL,
  expectedSha256: string,
  signal: AbortSignal,
): Promise<ReplayRenderPackageManifest> {
  if (!/^[0-9a-f]{64}$/.test(expectedSha256))
    throw new ReplayCapabilityError(
      "invalid-package",
      "A SHA-256 package identity is required",
    );
  const bytes = await download(url, signal, 16 * 1024 * 1024);
  if (
    bytes.byteLength > 16 * 1024 * 1024 ||
    (await sha256(bytes)) !== expectedSha256
  )
    throw new ReplayCapabilityError(
      "invalid-package",
      "Replay package manifest integrity check failed",
    );
  let input: unknown;
  try {
    input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new ReplayCapabilityError(
      "invalid-package",
      "Replay package manifest is not valid JSON",
    );
  }
  const parsed = ReplayRenderPackageManifestSchema.safeParse(input);
  if (!parsed.success)
    throw new ReplayCapabilityError(
      "invalid-package",
      "Replay package manifest does not satisfy the admitted package contract",
    );
  return parsed.data;
}

export function createVerifiedResources(
  manifest: ReplayRenderPackageManifest,
  manifestUrl: URL,
  signal: AbortSignal,
): ReplayResources & { dispose: () => void } {
  const root = new URL("./", manifestUrl);
  const inventory = new Map(manifest.files.map((file) => [file.path, file]));
  const pending = new Map<string, Promise<Uint8Array<ArrayBuffer>>>();
  const urls = new Map<string, Promise<string>>();
  const workers = new Set<Worker>();
  let disposed = false;
  const assertActive = () => {
    signal.throwIfAborted();
    if (disposed)
      throw new DOMException("Replay resources were disposed", "AbortError");
  };
  const read = async (path: string): Promise<Uint8Array<ArrayBuffer>> => {
    assertActive();
    const file = inventory.get(path);
    if (!file)
      throw new ReplayCapabilityError(
        "invalid-package",
        `Replay resource is outside its declared inventory: ${path}`,
      );
    const url = new URL(path, root);
    if (
      url.origin !== root.origin ||
      !url.pathname.startsWith(root.pathname) ||
      url.search ||
      url.hash
    )
      throw new ReplayCapabilityError(
        "invalid-package",
        "Replay resource escaped its immutable package root",
      );
    let request = pending.get(path);
    if (!request) {
      request = (async () => {
        const bytes = await download(url, signal, file.bytes);
        if (
          bytes.byteLength !== file.bytes ||
          (await sha256(bytes)) !== file.sha256
        )
          throw new ReplayCapabilityError(
            "invalid-package",
            `Replay resource integrity check failed: ${path}`,
          );
        assertActive();
        return bytes;
      })();
      pending.set(path, request);
    }
    const verified = await request;
    assertActive();
    return new Uint8Array(verified);
  };
  const objectUrl = async (
    path: string,
    mimeType = "application/octet-stream",
  ) => {
    assertActive();
    const key = `${mimeType}:${path}`;
    let request = urls.get(key);
    if (!request) {
      request = (async () => {
        const bytes = await read(path);
        assertActive();
        return URL.createObjectURL(new Blob([bytes], { type: mimeType }));
      })();
      urls.set(key, request);
    }
    const url = await request;
    assertActive();
    return url;
  };
  return {
    read,
    objectUrl,
    async moduleUrl(path) {
      await read(path);
      assertActive();
      const url = new URL(path, root);
      if (typeof location !== "undefined" && url.origin !== location.origin)
        throw new ReplayCapabilityError(
          "invalid-package",
          "Executable replay packages must be published on the Scout origin",
        );
      return url.href;
    },
    async worker(path) {
      const url = await objectUrl(path, "text/javascript");
      assertActive();
      const worker = new Worker(url, { type: "module" });
      workers.add(worker);
      return worker;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const worker of workers) worker.terminate();
      workers.clear();
      for (const request of urls.values()) void revokeWhenReady(request);
      urls.clear();
      pending.clear();
    },
  };
}

async function revokeWhenReady(pending: Promise<string>): Promise<void> {
  try {
    URL.revokeObjectURL(await pending);
  } catch {
    /* Failed URL creation is reported to the resource consumer. */
  }
}
