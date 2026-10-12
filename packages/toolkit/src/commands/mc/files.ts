import {
  FilesGetResponseSchema,
  FilesListResponseSchema,
  type RwfKind,
  RwfListResponseSchema,
} from "@shepherdjerred/mc-harness/protocol/files.ts";
import { daemonRequest } from "#lib/mc/client.ts";
import {
  defaultOut,
  renderFilesGet,
  renderFilesList,
  renderRwfList,
} from "#lib/mc/files.ts";

type FilesOptions = { target: string; json: boolean };

function print<T>(json: boolean, value: T, render: (value: T) => string): void {
  console.log(json ? JSON.stringify(value, null, 2) : render(value));
}

function filesPath(target: string, action: string, query?: string): string {
  return `/files/${encodeURIComponent(target)}/${action}${query === undefined ? "" : `?${query}`}`;
}

/** `path` has already passed the allowlist (normalizeDataPath). */
export async function mcFilesListCommand(
  options: FilesOptions & { path: string },
): Promise<void> {
  const listing = await daemonRequest(
    FilesListResponseSchema,
    "GET",
    filesPath(
      options.target,
      "ls",
      new URLSearchParams({ path: options.path }).toString(),
    ),
  );
  print(options.json, listing, renderFilesList);
}

export async function mcFilesGetCommand(
  options: FilesOptions & {
    path: string;
    out: string | undefined;
    force: boolean;
    gunzip: boolean;
  },
): Promise<void> {
  const got = await daemonRequest(
    FilesGetResponseSchema,
    "POST",
    filesPath(options.target, "get"),
    {
      path: options.path,
      out: defaultOut(options.path, options.out, options.gunzip),
      force: options.force,
      gunzip: options.gunzip,
    },
  );
  print(options.json, got, renderFilesGet);
}

export async function mcRwfListCommand(
  options: FilesOptions & { matchId: string | undefined },
): Promise<void> {
  const listing = await daemonRequest(
    RwfListResponseSchema,
    "GET",
    filesPath(
      options.target,
      "rwf",
      options.matchId === undefined
        ? undefined
        : new URLSearchParams({ match: options.matchId }).toString(),
    ),
  );
  print(options.json, listing, renderRwfList);
}

export async function mcRwfGetCommand(
  options: FilesOptions & {
    matchId: string;
    kind: RwfKind;
    outDir: string;
    force: boolean;
    gunzip: boolean;
  },
): Promise<void> {
  const got = await daemonRequest(
    FilesGetResponseSchema,
    "POST",
    filesPath(options.target, "rwf-get"),
    {
      matchId: options.matchId,
      kind: options.kind,
      outDir: options.outDir,
      force: options.force,
      gunzip: options.gunzip,
    },
  );
  print(options.json, got, renderFilesGet);
}
