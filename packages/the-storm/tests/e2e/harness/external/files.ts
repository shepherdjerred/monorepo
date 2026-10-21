/**
 * The server files the suites inspect: Paper's `logs/latest.log` and the
 * `plugins/TheStorm` data folder (the SQLite database and rwf recordings).
 *
 * A local Docker server gives them up through the Docker CLI. An external
 * server declares exactly one transport:
 *
 * - `shared`: the Woodpecker smoke lane mounts the server's log and plugin
 *   folders into the runner's workspace;
 * - `http`: `files-service.ts` runs beside Paper with read-only access
 *   to its `/data` and serves these files over the cluster network behind a
 *   bearer token (the in-cluster qualification sandbox).
 */
import path from "node:path";
import { z } from "zod";
import { serverLogs as dockerServerLogs } from "@shepherdjerred/mc-harness/providers/docker/docker-cli.ts";
import type { ServerInfo } from "#e2e/harness/server.ts";

/** Paper's log, relative to the server's `/data`. */
export const SERVER_LOG = "logs/latest.log";
/** TheStorm's data folder, relative to the server's `/data`. */
export const STORM_DATA_ROOT = "plugins/TheStorm";
/** The HTTP route prefix; the rest of the path is relative to `/data`. */
export const SERVER_FILES_ROUTE = "/v1/server-files/";

export const ServerFilesSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("shared"),
    logFile: z.string().min(1),
    stormDataDir: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal("http"),
    /** Origin of the files service, for example `http://10.42.0.7:18082`. */
    url: z.url({ protocol: /^https?$/u }),
    token: z.string().min(16),
  }),
]);
export type ServerFiles = z.infer<typeof ServerFilesSchema>;

/**
 * True when `relative` (POSIX, relative to `/data`) is Paper's log or a file
 * under `plugins/TheStorm`. Nothing else on the server is readable.
 */
export function isServedPath(relative: string): boolean {
  if (relative === SERVER_LOG) return true;
  const parts = relative.split("/");
  return (
    parts.length > 2 &&
    parts[0] === "plugins" &&
    parts[1] === "TheStorm" &&
    parts.every(
      (part) =>
        part !== "" && part !== "." && part !== ".." && !part.includes("\0"),
    )
  );
}

function servedPath(relative: string): string {
  if (!isServedPath(relative))
    throw new Error(
      `${relative} is not a served server file (${SERVER_LOG} or ${STORM_DATA_ROOT}/**)`,
    );
  return relative;
}

/** The request URL for one served file. */
export function serverFileUrl(origin: string, relative: string): URL {
  const encoded = servedPath(relative)
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return new URL(`${SERVER_FILES_ROUTE}${encoded}`, origin);
}

async function readShared(
  files: ServerFiles & { kind: "shared" },
  relative: string,
): Promise<Uint8Array | undefined> {
  const local =
    relative === SERVER_LOG
      ? files.logFile
      : path.join(
          files.stormDataDir,
          ...relative.split("/").slice(STORM_DATA_ROOT.split("/").length),
        );
  const file = Bun.file(local);
  return (await file.exists()) ? file.bytes() : undefined;
}

async function readHttp(
  files: ServerFiles & { kind: "http" },
  relative: string,
): Promise<Uint8Array | undefined> {
  const response = await fetch(serverFileUrl(files.url, relative), {
    headers: { authorization: `Bearer ${files.token}` },
    signal: AbortSignal.timeout(120_000),
  });
  if (response.status === 404) return undefined;
  if (!response.ok) {
    const reason = await response.text();
    throw new Error(
      `Server files service refused ${relative}: HTTP ${response.status.toString()} ${reason.trim()}`,
    );
  }
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * One served file from an external server, or undefined when the server has
 * no such file yet.
 */
export async function readServerFile(
  files: ServerFiles,
  relative: string,
): Promise<Uint8Array | undefined> {
  servedPath(relative);
  switch (files.kind) {
    case "shared": {
      return readShared(files, relative);
    }
    case "http": {
      return readHttp(files, relative);
    }
  }
}

/** The complete Paper log of the server under test. */
export async function serverLogs(info: ServerInfo): Promise<string> {
  if (info.kind === "container")
    return dockerServerLogs({
      kind: "container",
      containerId: info.containerId,
    });
  const log = await readServerFile(info.files, SERVER_LOG);
  if (log === undefined)
    throw new Error(`The external server has no ${SERVER_LOG}`);
  return new TextDecoder().decode(log);
}
