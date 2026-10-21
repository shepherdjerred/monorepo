/**
 * Serves the files the suites inspect (`files.ts`) from a Paper
 * server's `/data` over HTTP, for an external server whose disk the runner
 * cannot mount. It runs beside Paper (a sidecar container with `/data`
 * mounted read-only), is test-only, and never ships in a server image.
 *
 *   STORM_E2E_SERVER_DATA_DIR=/data STORM_E2E_FILES_PORT=18082 \
 *   STORM_E2E_FILES_TOKEN=... bun tests/e2e/harness/external/files-service.ts
 */
import { timingSafeEqual } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  isServedPath,
  SERVER_FILES_ROUTE,
} from "#e2e/harness/external/files.ts";

export type ServerFilesService = {
  port: number;
  stop: () => Promise<void>;
};

function authorized(header: string | null, token: string): boolean {
  const expected = Buffer.from(`Bearer ${token}`);
  const actual = Buffer.from(header ?? "");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function decodeRelative(pathname: string): string | undefined {
  try {
    return pathname
      .slice(SERVER_FILES_ROUTE.length)
      .split("/")
      .map((part) => decodeURIComponent(part))
      .join("/");
  } catch {
    return undefined;
  }
}

/** The canonical path inside `root`, or undefined when it does not exist. */
async function resolveInside(
  root: string,
  relative: string,
): Promise<string | undefined> {
  let resolved: string;
  try {
    resolved = await realpath(path.join(root, ...relative.split("/")));
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")
    )
      return undefined;
    throw error;
  }
  // A symlink inside the data folder must not escape it.
  if (!resolved.startsWith(`${root}${path.sep}`)) return undefined;
  const entry = await stat(resolved);
  return entry.isFile() ? resolved : undefined;
}

export async function startServerFilesService(options: {
  dataDir: string;
  token: string;
  port: number;
}): Promise<ServerFilesService> {
  z.string().min(16).parse(options.token);
  const root = await realpath(options.dataDir);
  const rootEntry = await stat(root);
  if (!rootEntry.isDirectory())
    throw new Error(`${options.dataDir} is not the server's data directory`);
  const server = Bun.serve({
    hostname: "0.0.0.0",
    port: options.port,
    fetch: async (request) => {
      if (!authorized(request.headers.get("authorization"), options.token))
        return new Response("unauthorized\n", { status: 401 });
      if (request.method !== "GET")
        return new Response("method not allowed\n", { status: 405 });
      const url = new URL(request.url);
      if (!url.pathname.startsWith(SERVER_FILES_ROUTE))
        return new Response("not found\n", { status: 404 });
      const relative = decodeRelative(url.pathname);
      if (relative === undefined || !isServedPath(relative))
        return new Response("not a served file\n", { status: 403 });
      const file = await resolveInside(root, relative);
      if (file === undefined)
        return new Response("not found\n", { status: 404 });
      return new Response(Bun.file(file), {
        headers: { "content-type": "application/octet-stream" },
      });
    },
  });
  if (server.port === undefined)
    throw new Error("server files service did not bind a port");
  return { port: server.port, stop: async () => server.stop() };
}

if (import.meta.main) {
  const env = z
    .object({
      STORM_E2E_SERVER_DATA_DIR: z.string().min(1),
      STORM_E2E_FILES_PORT: z.coerce.number().int().min(1).max(65_535),
      STORM_E2E_FILES_TOKEN: z.string().min(16),
    })
    .parse(Bun.env);
  const service = await startServerFilesService({
    dataDir: env.STORM_E2E_SERVER_DATA_DIR,
    token: env.STORM_E2E_FILES_TOKEN,
    port: env.STORM_E2E_FILES_PORT,
  });
  console.warn(
    `Server files service listening on port ${service.port.toString()}`,
  );
  await new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  await service.stop();
}
