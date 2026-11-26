import { z } from "zod";
import type { Actor } from "#shared/contract.ts";
import { APP_ORIGIN, type TestRuntime } from "./runtime.ts";

/** Headers the CLI sends: an agent actor and no fetch metadata. */
export function agentHeaders(
  name: string,
  workspace = "karpathy:/work/tree",
): Record<string, string> {
  const [hostname = "host", worktree = "/work"] = workspace.split(":");
  const actor: Actor = {
    key: `agent:${name}`,
    kind: "agent",
    name,
    metadata: { hostname, worktree },
  };
  return {
    "X-Artifacts-Actor": Buffer.from(JSON.stringify(actor)).toString("base64"),
  };
}

/** Headers a same-origin browser request carries. */
export function humanHeaders(): Record<string, string> {
  return { Origin: APP_ORIGIN, "Sec-Fetch-Site": "same-origin" };
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`HTTP ${String(status)}: ${JSON.stringify(body)}`);
  }
}

async function parse(response: Response): Promise<unknown> {
  const text = await response.text();
  return text.length === 0 ? null : JSON.parse(text);
}

export function createClient(
  runtime: TestRuntime,
  headers: Record<string, string>,
) {
  async function trpc(
    procedure: string,
    kind: "query" | "mutation",
    input?: unknown,
  ): Promise<unknown> {
    const query =
      input === undefined
        ? ""
        : `?input=${encodeURIComponent(JSON.stringify(input))}`;
    const response =
      kind === "query"
        ? await runtime.call("app", `/trpc/${procedure}${query}`, { headers })
        : await runtime.call("app", `/trpc/${procedure}`, {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify(input ?? {}),
          });
    const body = await parse(response);
    if (!response.ok) throw new HttpError(response.status, body);
    return z.object({ result: z.object({ data: z.unknown() }) }).parse(body)
      .result.data;
  }
  return {
    query: (procedure: string, input?: unknown) =>
      trpc(procedure, "query", input),
    mutate: (procedure: string, input?: unknown) =>
      trpc(procedure, "mutation", input),
    async json(path: string, init: { method?: string; body?: unknown } = {}) {
      const response = await runtime.call("app", path, {
        method: init.method ?? "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      });
      const body = await parse(response);
      if (!response.ok) throw new HttpError(response.status, body);
      return body;
    },
    async putBlob(
      uploadId: string,
      sha256: string,
      bytes: Uint8Array<ArrayBuffer> | string,
    ) {
      const response = await runtime.call(
        "app",
        `/api/uploads/${uploadId}/blobs/${sha256}`,
        {
          method: "PUT",
          headers,
          body: bytes,
        },
      );
      const body = await parse(response);
      if (!response.ok) throw new HttpError(response.status, body);
      return body;
    },
  };
}
export type TestClient = ReturnType<typeof createClient>;

export async function sha256Hex(
  bytes: Uint8Array<ArrayBuffer>,
): Promise<string> {
  return Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString(
    "hex",
  );
}

export type PublishFiles = Record<string, { body: string; mediaType: string }>;

const UploadResponse = z.object({
  uploadId: z.string(),
  missing: z.array(z.string()),
  expiresAt: z.string(),
  deduplicated: z.boolean(),
});
const CommitResponse = z.object({
  artifactId: z.string(),
  versionId: z.string(),
  number: z.number(),
  reviewUrl: z.string(),
  boardUrl: z.string(),
  deduplicated: z.boolean(),
});

/** The manifest of an upload, built from file bodies. */
export async function manifest(files: PublishFiles) {
  return Promise.all(
    Object.entries(files).map(async ([path, file]) => {
      const bytes = new TextEncoder().encode(file.body);
      return {
        path,
        size: bytes.length,
        sha256: await sha256Hex(bytes),
        mediaType: file.mediaType,
      };
    }),
  );
}

export type PublishOptions = {
  board?: string;
  title?: string;
  entryPath?: string;
  artifactId?: string;
  expected?: string | null;
  key?: string;
  kind?: string;
  boardTitle?: string;
};

/** The whole publish: create, upload what is missing, commit. */
export async function publish(
  client: TestClient,
  files: PublishFiles,
  options: PublishOptions = {},
) {
  const request = {
    board: options.board ?? "demo",
    title: options.title ?? "Concept",
    entryPath: options.entryPath ?? Object.keys(files)[0] ?? "index.html",
    idempotencyKey: options.key ?? crypto.randomUUID(),
    expectedCurrentVersionId: options.expected ?? null,
    files: await manifest(files),
    ...(options.artifactId === undefined
      ? {}
      : { artifactId: options.artifactId }),
    ...(options.kind === undefined ? {} : { kind: options.kind }),
    ...(options.boardTitle === undefined
      ? {}
      : { boardTitle: options.boardTitle }),
  };
  const created = UploadResponse.parse(
    await client.json("/api/uploads", { body: request }),
  );
  const bodies = new Map(
    request.files.map((file) => [file.sha256, files[file.path]?.body ?? ""]),
  );
  for (const sha256 of created.missing)
    await client.putBlob(created.uploadId, sha256, bodies.get(sha256) ?? "");
  const committed = CommitResponse.parse(
    await client.json(`/api/uploads/${created.uploadId}/commit`),
  );
  return { created, committed, request };
}
