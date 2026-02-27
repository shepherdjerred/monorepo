import { readFile, writeFile, mkdir, unlink, stat, rename } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const FileEntrySchema = z.object({
  uid: z.number(),
  path: z.string(),
  hash: z.string(),
  mtime: z.number(),
  ctime: z.number(),
  size: z.number(),
  folder: z.boolean(),
  deleted: z.boolean(),
});

const VaultStateSchema = z.object({
  version: z.number(),
  files: z.record(z.string(), FileEntrySchema),
});

export type FileEntry = z.infer<typeof FileEntrySchema>;
export type VaultState = z.infer<typeof VaultStateSchema>;

const STATE_FILENAME = ".obsidian-sync-state.json";
const JUST_WRITTEN_TTL_MS = 2000;

export class VaultManager {
  private readonly vaultPath: string;
  private state: VaultState;
  private readonly justWritten = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(vaultPath: string) {
    this.vaultPath = vaultPath;
    this.state = { version: 0, files: {} };
  }

  get basePath(): string {
    return this.vaultPath;
  }

  get version(): number {
    return this.state.version;
  }

  set version(v: number) {
    this.state.version = v;
  }

  get files(): Record<string, FileEntry> {
    return this.state.files;
  }

  get isInitialSync(): boolean {
    return this.state.version === 0;
  }

  async loadState(): Promise<void> {
    const statePath = path.join(this.vaultPath, STATE_FILENAME);
    try {
      const data = await readFile(statePath, "utf8");
      this.state = VaultStateSchema.parse(JSON.parse(data));
    } catch {
      this.state = { version: 0, files: {} };
    }
  }

  async saveState(): Promise<void> {
    const statePath = path.join(this.vaultPath, STATE_FILENAME);
    await mkdir(path.dirname(statePath), { recursive: true });
    await writeFile(statePath, JSON.stringify(this.state, null, 2));
  }

  async writeFile(
    filePath: string,
    content: ArrayBuffer,
    entry: Omit<FileEntry, "path">,
  ): Promise<void> {
    const fullPath = path.join(this.vaultPath, filePath);
    await mkdir(path.dirname(fullPath), { recursive: true });
    this.markJustWritten(filePath);
    await writeFile(fullPath, Buffer.from(content));
    this.state.files[filePath] = { ...entry, path: filePath };
  }

  async createFolder(
    folderPath: string,
    entry: Omit<FileEntry, "path">,
  ): Promise<void> {
    const fullPath = path.join(this.vaultPath, folderPath);
    await mkdir(fullPath, { recursive: true });
    this.state.files[folderPath] = { ...entry, path: folderPath };
  }

  async deleteFile(filePath: string): Promise<void> {
    const fullPath = path.join(this.vaultPath, filePath);
    this.markJustWritten(filePath);
    try {
      await unlink(fullPath);
    } catch {
      // File may already be deleted
    }
    const entry = this.state.files[filePath];
    if (entry) {
      entry.deleted = true;
    }
  }

  async readFileContent(filePath: string): Promise<ArrayBuffer> {
    const fullPath = path.join(this.vaultPath, filePath);
    const buffer = await readFile(fullPath);
    const ab = new ArrayBuffer(buffer.byteLength);
    new Uint8Array(ab).set(buffer);
    return ab;
  }

  async getFileStat(
    filePath: string,
  ): Promise<{ mtime: number; size: number } | null> {
    try {
      const fullPath = path.join(this.vaultPath, filePath);
      const stats = await stat(fullPath);
      return { mtime: stats.mtimeMs, size: stats.size };
    } catch {
      return null;
    }
  }

  getEntry(filePath: string): FileEntry | undefined {
    return this.state.files[filePath];
  }

  async renameFile(
    oldPath: string,
    newPath: string,
    entry: Omit<FileEntry, "path">,
  ): Promise<void> {
    const oldFull = path.join(this.vaultPath, oldPath);
    const newFull = path.join(this.vaultPath, newPath);
    await mkdir(path.dirname(newFull), { recursive: true });
    try {
      await rename(oldFull, newFull);
    } catch {
      // Source may not exist locally yet
    }
    this.removeEntry(oldPath);
    this.state.files[newPath] = { ...entry, path: newPath };
  }

  removeEntry(filePath: string): void {
    const files = this.state.files;
    const newFiles: Record<string, FileEntry> = {};
    for (const [key, value] of Object.entries(files)) {
      if (key !== filePath) {
        newFiles[key] = value;
      }
    }
    this.state.files = newFiles;
  }

  markJustWritten(filePath: string): void {
    const existing = this.justWritten.get(filePath);
    if (existing !== undefined) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      this.justWritten.delete(filePath);
    }, JUST_WRITTEN_TTL_MS);
    this.justWritten.set(filePath, timer);
  }

  isJustWritten(filePath: string): boolean {
    return this.justWritten.has(filePath);
  }
}
