import { chmod, mkdir, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { sha256Hex, type Opener } from "#lib/brim/sync/crypto.ts";
import {
  MACHINE_ID_PATTERN,
  writePrivateFile,
} from "#lib/brim/sync/manifest.ts";
import type { ObjectStore } from "#lib/brim/sync/object-store.ts";
import type { HistoryApiCapture } from "#lib/history/api/schema.ts";
import { parseHistorySourceName } from "#lib/history/types.ts";
import {
  CAPTURE_ARCHIVE_MAX_BYTES,
  CAPTURE_ARCHIVE_PREFIX,
  CaptureArchiveManifest,
  captureCutoff,
  captureManifestKey,
  capturePrefix,
  captureSnapshotKey,
} from "./archive-export.ts";
import {
  captureDetail,
  listCaptures,
  type CaptureSessionTarget,
} from "./queries.ts";
import { CaptureStore } from "./store.ts";

const LOCAL_ID_RANGE = 2 ** 32;
const EMPTY = { captures: [], hasMore: false };

function archiveMachineCode(machineId: string): number {
  // 20 digest bits preserve 32 local ID bits inside a safe integer.
  return Number.parseInt(sha256Hex(machineId).slice(0, 5), 16);
}

function archiveId(machineId: string, localId: number): number {
  if (
    !Number.isSafeInteger(localId) ||
    localId < 1 ||
    localId >= LOCAL_ID_RANGE
  ) {
    throw new Error("Brim capture id exceeds the archive id range");
  }
  return LOCAL_ID_RANGE * archiveMachineCode(machineId) + localId;
}

function globalCapture(
  machineId: string,
  capture: HistoryApiCapture,
): HistoryApiCapture {
  return {
    ...capture,
    id: archiveId(machineId, capture.id),
    previousCaptureId:
      capture.previousCaptureId === null
        ? null
        : archiveId(machineId, capture.previousCaptureId),
  };
}

type ArchiveSession = CaptureSessionTarget & { readonly machineId: string };
type Page = { readonly limit: number; readonly offset: number };
type CaptureMirrorOptions = {
  readonly directory: string;
  readonly store: ObjectStore;
  readonly open: Opener;
};

export class CaptureArchiveReader {
  readonly #options: CaptureMirrorOptions;
  readonly #stores = new Map<string, CaptureStore>();
  readonly #machines = new Map<number, string>();

  private constructor(options: CaptureMirrorOptions) {
    this.#options = options;
  }

  static async open(
    options: CaptureMirrorOptions,
  ): Promise<CaptureArchiveReader> {
    await mkdir(options.directory, { recursive: true, mode: 0o700 });
    const reader = new CaptureArchiveReader(options);
    try {
      const files = await readdir(options.directory);
      for (const name of files) {
        const machineId = /^([a-z0-9-]+)\.sqlite$/u.exec(name)?.[1];
        if (machineId === undefined || !MACHINE_ID_PATTERN.test(machineId))
          continue;
        reader.#install(
          machineId,
          CaptureStore.openArchived(path.join(options.directory, name)),
        );
      }
      return reader;
    } catch (error: unknown) {
      reader.close();
      throw error;
    }
  }

  close(): void {
    for (const store of this.#stores.values()) store.close();
    this.#stores.clear();
    this.#machines.clear();
  }

  #assertMachineId(machineId: string): void {
    const known = this.#machines.get(archiveMachineCode(machineId));
    if (known !== undefined && machineId !== known) {
      throw new Error("Brim capture archive machine identifiers collided");
    }
  }

  #install(machineId: string, store: CaptureStore): void {
    try {
      this.#assertMachineId(machineId);
      this.#stores.get(machineId)?.close();
      this.#stores.set(machineId, store);
      this.#machines.set(archiveMachineCode(machineId), machineId);
    } catch (error: unknown) {
      store.close();
      throw error;
    }
  }

  async #refreshMachine(machineId: string): Promise<void> {
    const { directory, store, open } = this.#options;
    const prefix = capturePrefix(machineId);
    const sealedManifest = await store.get(captureManifestKey(prefix));
    if (sealedManifest === null) return;
    const { digest } = CaptureArchiveManifest.parse(
      JSON.parse(new TextDecoder().decode(await open(sealedManifest))),
    );
    const digestPath = path.join(directory, `${machineId}.sha256`);
    const oldDigest = Bun.file(digestPath);
    if (
      this.#stores.has(machineId) &&
      (await oldDigest.exists()) &&
      (await oldDigest.text()) === digest
    )
      return;

    const key = captureSnapshotKey(prefix, digest);
    const sealed = await store.get(key);
    if (sealed === null)
      throw new Error("Brim capture archive commit is missing its snapshot");
    const bytes = await open(sealed);
    if (
      bytes.byteLength > CAPTURE_ARCHIVE_MAX_BYTES ||
      sha256Hex(bytes) !== digest
    ) {
      throw new Error("Brim capture archive snapshot failed integrity checks");
    }

    this.#assertMachineId(machineId);
    const file = path.join(directory, `${machineId}.sqlite`);
    const temporary = `${file}.incoming`;
    try {
      await Bun.write(temporary, bytes);
      if (process.platform !== "win32") await chmod(temporary, 0o600);
      CaptureStore.openArchived(temporary).close();
      await rename(temporary, file);
      this.#install(machineId, CaptureStore.openArchived(file));
      await writePrivateFile(digestPath, digest);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  async refresh(): Promise<void> {
    const machines = await this.#options.store.listChildren(
      CAPTURE_ARCHIVE_PREFIX,
    );
    let failures = 0;
    for (const machineId of machines) {
      try {
        await this.#refreshMachine(machineId);
      } catch {
        failures++;
      }
    }
    if (failures !== 0) {
      throw new Error(
        `Brim capture refresh failed for ${String(failures)} devices`,
      );
    }
  }

  list(session: ArchiveSession | null, page: Page, now: Date) {
    const since = captureCutoff(now);
    if (session !== null) {
      const store = this.#stores.get(session.machineId);
      if (store === undefined) return EMPTY;
      const result = listCaptures(store, {
        ...page,
        since,
        session: {
          ...session,
          source: parseHistorySourceName(
            session.source.replace(/-mirror$/u, ""),
            "in Brim capture archive",
          ),
        },
      });
      return {
        captures: result.captures.map((capture) =>
          globalCapture(session.machineId, capture),
        ),
        hasMore: result.hasMore,
      };
    }
    const captures = [...this.#stores]
      .flatMap(([machineId, store]) =>
        listCaptures(store, {
          since,
          session: null,
          limit: page.offset + page.limit + 1,
          offset: 0,
        }).captures.map((capture) => globalCapture(machineId, capture)),
      )
      .toSorted(
        (left, right) =>
          right.startedAt.localeCompare(left.startedAt) || right.id - left.id,
      );
    const end = page.offset + page.limit;
    return {
      captures: captures.slice(page.offset, end),
      hasMore: captures.length > end,
    };
  }

  detail(id: number, now: Date) {
    if (!Number.isSafeInteger(id) || id < 1) return null;
    const machineId = this.#machines.get(Math.floor(id / LOCAL_ID_RANGE));
    if (machineId === undefined) return null;
    const store = this.#stores.get(machineId);
    if (store === undefined) return null;
    const detail = captureDetail(
      store,
      id % LOCAL_ID_RANGE,
      captureCutoff(now),
    );
    return detail === null
      ? null
      : { ...detail, capture: globalCapture(machineId, detail.capture) };
  }
}
