import { readFile } from "node:fs/promises";
import {
  IdSchema,
  ManifestSchema,
  FileOperationConflict,
  type FileOperationManifest,
} from "#filesystem/operations-types.ts";
import {
  exists,
  saveManifest,
  type ManifestSaveHooks,
} from "#filesystem/operations-io.ts";

export type JournalCompletionRecorder = (
  manifest: FileOperationManifest,
  save: (hooks?: ManifestSaveHooks) => Promise<void>,
) => Promise<void>;

/** Original mutable v1 operation journal; independent immutable effect records do not alter it. */
export class OperationJournal {
  constructor(
    private readonly controlPath: (relative: string) => Promise<string>,
    private readonly recordCompletion?: JournalCompletionRecorder,
    private readonly beforeInstall?: () => void,
  ) {}

  async read(operationId: string): Promise<FileOperationManifest | null> {
    IdSchema.parse(operationId);
    const path = await this.controlPath(`journal/${operationId}.json`);
    return (await exists(path))
      ? ManifestSchema.parse(JSON.parse(await readFile(path, "utf8")))
      : null;
  }

  async prepare(
    descriptor: FileOperationManifest,
  ): Promise<FileOperationManifest> {
    const existing = await this.read(descriptor.operationId);
    if (existing !== null) {
      if (
        JSON.stringify({ ...existing, phase: "prepared" }) !==
        JSON.stringify(descriptor)
      )
        throw new FileOperationConflict(
          "Operation identifier was reused with different inputs",
        );
      return existing;
    }
    await this.save(descriptor);
    return descriptor;
  }

  async complete(
    manifest: FileOperationManifest,
  ): Promise<FileOperationManifest> {
    const completed: FileOperationManifest = { ...manifest, phase: "complete" };
    if (this.recordCompletion === undefined) await this.save(completed);
    else
      await this.recordCompletion(manifest, async (hooks) => {
        const path = await this.controlPath(
          `journal/${manifest.operationId}.json`,
        );
        await saveManifest(path, completed, {
          ...hooks,
          beforeInstall: () => {
            this.beforeInstall?.();
            hooks?.beforeInstall?.();
          },
        });
      });
    return completed;
  }

  async save(manifest: FileOperationManifest): Promise<void> {
    const path = await this.controlPath(`journal/${manifest.operationId}.json`);
    await saveManifest(
      path,
      manifest,
      this.beforeInstall === undefined
        ? undefined
        : { beforeInstall: this.beforeInstall },
    );
  }
}
