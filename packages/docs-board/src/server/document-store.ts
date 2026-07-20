import {
  createDocumentSnapshot,
  readDocumentPath,
  type DocumentIndexSnapshot,
  type InvalidFile,
  type ParsedFile,
} from "#server/document-index";
import {
  parseMarkdownDocument,
  serializeMarkdownDocument,
} from "#shared/markdown";
import {
  DocumentListResponseSchema,
  FrontmatterSchema,
  type DocumentDetail,
  type DocumentChange,
  type DocumentListResponse,
  type DocumentStatus,
  type DocumentSummary,
} from "#shared/schema";

export class DocumentNotFoundError extends Error {}
export class DocumentConflictError extends Error {}
export class DocumentWorkflowError extends Error {}

type StoreOptions = {
  repoRoot: string;
  watchFiles?: boolean;
  watchIntervalMs?: number;
};

type StatusChange = {
  revision: string;
  status: DocumentStatus;
  actor: string;
  note?: string | undefined;
};

async function commandValue(
  repoRoot: string,
  command: string[],
): Promise<string> {
  const process = Bun.spawn(command, {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `${command.join(" ")} failed: ${stderr.trim() || String(exitCode)}`,
    );
  }
  return stdout.trim();
}

async function gitValue(
  repoRoot: string,
  gitArguments: string[],
): Promise<string> {
  return commandValue(repoRoot, ["git", ...gitArguments]);
}

function appendCommentLog(
  body: string,
  actor: string,
  content: string,
  timestamp: string,
): string {
  const safeActor = actor.replaceAll(/[\r\n#]/gu, " ").trim();
  const entry = `### ${timestamp} - ${safeActor}\n\n${content.trim()}\n`;
  if (/^## Comment Log\s*$/mu.test(body)) {
    return `${body.trimEnd()}\n\n${entry}`;
  }
  return `${body.trimEnd()}\n\n## Comment Log\n\n${entry}`;
}

export class DocumentStore {
  readonly repoRoot: string;
  readonly docsRoot: string;
  private readonly listeners = new Set<(event: DocumentChange) => void>();
  private readonly writeQueues = new Map<string, Promise<null>>();
  private readonly watchIntervalMs: number;
  private cacheRefreshQueue = Promise.resolve(null);
  private scanGeneration = 0;
  private scanPromise: Promise<DocumentIndexSnapshot> | null = null;
  private scanSnapshot: DocumentIndexSnapshot | null = null;
  private watchTimer: ReturnType<typeof setInterval> | null = null;
  private watchInitialized = false;
  private watchSignatures = new Map<string, string>();
  private watching = false;

  constructor(options: StoreOptions) {
    this.repoRoot = options.repoRoot;
    this.docsRoot = `${options.repoRoot}/packages/docs`;
    this.watchIntervalMs = options.watchIntervalMs ?? 1000;
    if (options.watchFiles !== false) this.startWatcher();
  }

  close(): void {
    if (this.watchTimer !== null) clearInterval(this.watchTimer);
    this.watchTimer = null;
  }

  subscribe(listener: (event: DocumentChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private publishChange(documentId: string | null): void {
    const event: DocumentChange = {
      documentId,
      changedAt: new Date().toISOString(),
    };
    for (const listener of this.listeners) listener(event);
  }

  private invalidateSnapshot(): void {
    this.scanGeneration += 1;
    this.scanPromise = null;
    this.scanSnapshot = null;
  }

  private fileSignatures(): Map<string, string> {
    const glob = new Bun.Glob("**/*.md");
    const paths = [
      ...glob.scanSync({ cwd: this.docsRoot, onlyFiles: true }),
    ].sort();
    return new Map(
      paths.map((path) => {
        const file = Bun.file(`${this.docsRoot}/${path}`);
        return [path, `${String(file.size)}:${String(file.lastModified)}`];
      }),
    );
  }

  private changedPaths(
    previous: Map<string, string>,
    current: Map<string, string>,
  ): string[] {
    const paths = new Set([...previous.keys(), ...current.keys()]);
    return [...paths]
      .filter((path) => previous.get(path) !== current.get(path))
      .sort();
  }

  private startWatcher(): void {
    const poll = async (): Promise<void> => {
      if (this.watching) return;
      this.watching = true;
      try {
        const signatures = this.fileSignatures();
        const changed = this.changedPaths(this.watchSignatures, signatures);
        if (this.watchInitialized && changed.length > 0) {
          await this.refreshCachedPaths(changed);
          this.publishChange(null);
        }
        this.watchSignatures = signatures;
        this.watchInitialized = true;
      } catch (error) {
        console.error("docs watcher failed", error);
      } finally {
        this.watching = false;
      }
    };
    void poll();
    this.watchTimer = setInterval(() => void poll(), this.watchIntervalMs);
  }

  private async buildSnapshot(): Promise<DocumentIndexSnapshot> {
    const glob = new Bun.Glob("**/*.md");
    const paths = [
      ...glob.scanSync({ cwd: this.docsRoot, onlyFiles: true }),
    ].sort();
    const entries = await Promise.all(
      paths.map(async (path) => ({
        path,
        file: await readDocumentPath(this.docsRoot, path),
      })),
    );
    const filesByPath = new Map<string, ParsedFile | InvalidFile>();
    for (const entry of entries) {
      if (entry.file !== null) filesByPath.set(entry.path, entry.file);
    }
    return createDocumentSnapshot(filesByPath);
  }

  private async scan(): Promise<DocumentIndexSnapshot> {
    if (this.scanSnapshot !== null) return this.scanSnapshot;
    if (this.scanPromise !== null) return this.scanPromise;
    const generation = this.scanGeneration;
    const pending = this.buildSnapshot();
    this.scanPromise = pending;
    try {
      const snapshot = await pending;
      if (generation === this.scanGeneration) this.scanSnapshot = snapshot;
      return snapshot;
    } finally {
      if (this.scanPromise === pending) this.scanPromise = null;
    }
  }

  private async refreshCachedPaths(paths: string[]): Promise<void> {
    const previous = this.cacheRefreshQueue;
    const gate = Promise.withResolvers<null>();
    this.cacheRefreshQueue = gate.promise;
    await previous;
    try {
      const snapshot = this.scanSnapshot;
      if (snapshot === null) {
        this.invalidateSnapshot();
        return;
      }
      const entries = await Promise.all(
        paths.map(async (path) => ({
          path,
          file: await readDocumentPath(this.docsRoot, path),
        })),
      );
      if (this.scanSnapshot !== snapshot) return;
      const filesByPath = new Map(snapshot.filesByPath);
      for (const entry of entries) {
        if (entry.file === null) filesByPath.delete(entry.path);
        else filesByPath.set(entry.path, entry.file);
      }
      this.scanSnapshot = createDocumentSnapshot(filesByPath);
    } finally {
      gate.resolve(null);
    }
  }

  async list(): Promise<DocumentListResponse> {
    const [scan, branch, status, actor] = await Promise.all([
      this.scan(),
      gitValue(this.repoRoot, ["branch", "--show-current"]),
      gitValue(this.repoRoot, ["status", "--porcelain"]),
      gitValue(this.repoRoot, ["config", "user.name"]),
    ]);
    const documents: DocumentSummary[] = scan.valid.map((file) => {
      const detail = file.detail;
      return {
        id: detail.id,
        path: detail.path,
        title: detail.title,
        type: detail.type,
        status: detail.status,
        board: detail.board,
        verification: detail.verification,
        disposition: detail.disposition,
        remainingCount: detail.remainingCount,
        hasHumanVerification: detail.hasHumanVerification,
        commentCount: detail.commentCount,
        lastActivity: detail.lastActivity,
        revision: detail.revision,
      };
    });
    return DocumentListResponseSchema.parse({
      repository: {
        root: this.repoRoot,
        branch,
        dirty: status !== "",
        actor,
      },
      documents,
      invalidDocuments: scan.invalid,
    });
  }

  async get(id: string): Promise<DocumentDetail> {
    const file = await this.getFile(id);
    return file.detail;
  }

  private async getFile(id: string): Promise<ParsedFile> {
    const scan = await this.scan();
    const file = scan.validById.get(id);
    if (file === undefined) throw new DocumentNotFoundError(id);
    return file;
  }

  private async getFreshFile(id: string): Promise<ParsedFile> {
    const indexed = await this.getFile(id);
    await this.refreshCachedPaths([indexed.detail.path]);
    return this.getFile(id);
  }

  private async withWriteQueue<T>(
    path: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.writeQueues.get(path) ?? Promise.resolve(null);
    const gate = Promise.withResolvers<null>();
    this.writeQueues.set(path, gate.promise);
    await previous;
    try {
      return await operation();
    } finally {
      gate.resolve(null);
      if (this.writeQueues.get(path) === gate.promise)
        this.writeQueues.delete(path);
    }
  }

  private async atomicWrite(path: string, content: string): Promise<void> {
    const temporaryPath = `${path}.docs-board-${crypto.randomUUID()}.tmp`;
    await Bun.write(temporaryPath, content);
    try {
      await commandValue(this.repoRoot, ["mv", "--", temporaryPath, path]);
    } catch (error) {
      try {
        const temporaryFile = Bun.file(temporaryPath);
        if (await temporaryFile.exists()) await temporaryFile.delete();
      } catch (cleanupError) {
        console.error("failed to clean temporary docs file", cleanupError);
      }
      throw error;
    }
  }

  private validateRevision(file: ParsedFile, revision: string): void {
    if (file.detail.revision !== revision) {
      throw new DocumentConflictError(
        "This document changed on disk. Refresh before writing.",
      );
    }
  }

  async updateStatus(
    id: string,
    change: StatusChange,
  ): Promise<DocumentDetail> {
    const initial = await this.getFreshFile(id);
    return this.withWriteQueue(initial.absolutePath, async () => {
      const file = await this.getFreshFile(id);
      this.validateRevision(file, change.revision);
      const parsed = parseMarkdownDocument(file.raw);
      if (change.status === "awaiting-human") {
        if (parsed.frontmatter.verification !== "human") {
          throw new DocumentWorkflowError(
            "Only documents with human verification can await human confirmation.",
          );
        }
        if (
          parsed.metadata.remainingCount !== 0 ||
          !parsed.metadata.hasHumanVerification
        ) {
          throw new DocumentWorkflowError(
            "Clear Remaining and add Human Verification before requesting confirmation.",
          );
        }
      }
      if (change.status === "complete") {
        if (parsed.metadata.remainingCount !== 0) {
          throw new DocumentWorkflowError(
            "Complete every Remaining item before marking this document complete.",
          );
        }
        if (parsed.frontmatter.source_marker === true) {
          throw new DocumentWorkflowError(
            "Remove the matching source TODO marker before completion.",
          );
        }
        if (
          parsed.frontmatter.verification === "human" &&
          parsed.frontmatter.status !== "awaiting-human"
        ) {
          throw new DocumentWorkflowError(
            "Human-verified work must pass through Awaiting Human Confirmation.",
          );
        }
      }
      const frontmatter = FrontmatterSchema.parse({
        ...parsed.frontmatter,
        status: change.status,
      });
      const noteText =
        change.note === undefined || change.note === ""
          ? ""
          : `\n\n${change.note}`;
      const audit = `Moved \`${parsed.frontmatter.status}\` -> \`${change.status}\`.${noteText}`;
      const body = appendCommentLog(
        parsed.body,
        change.actor,
        audit,
        new Date().toISOString(),
      );
      await this.atomicWrite(
        file.absolutePath,
        serializeMarkdownDocument(frontmatter, body),
      );
      await this.refreshCachedPaths([file.detail.path]);
      const updated = await this.get(id);
      this.publishChange(id);
      return updated;
    });
  }

  async addComment(
    id: string,
    revision: string,
    actor: string,
    comment: string,
  ): Promise<DocumentDetail> {
    const initial = await this.getFreshFile(id);
    return this.withWriteQueue(initial.absolutePath, async () => {
      const file = await this.getFreshFile(id);
      this.validateRevision(file, revision);
      const parsed = parseMarkdownDocument(file.raw);
      const body = appendCommentLog(
        parsed.body,
        actor,
        comment,
        new Date().toISOString(),
      );
      await this.atomicWrite(
        file.absolutePath,
        serializeMarkdownDocument(parsed.frontmatter, body),
      );
      await this.refreshCachedPaths([file.detail.path]);
      const updated = await this.get(id);
      this.publishChange(id);
      return updated;
    });
  }

  async archive(
    id: string,
    revision: string,
    actor: string,
  ): Promise<DocumentDetail> {
    const initial = await this.getFreshFile(id);
    return this.withWriteQueue(initial.absolutePath, async () => {
      const file = await this.getFreshFile(id);
      this.validateRevision(file, revision);
      if (file.detail.status !== "complete") {
        throw new DocumentWorkflowError(
          "Only complete documents can be archived.",
        );
      }
      if (file.detail.type !== "plan" && file.detail.type !== "todo") {
        throw new DocumentWorkflowError(
          "Only plans and TODOs use completed archival.",
        );
      }
      if (file.detail.remainingCount !== 0) {
        throw new DocumentWorkflowError("Remaining work blocks archival.");
      }
      if (file.detail.frontmatter.source_marker === true) {
        throw new DocumentWorkflowError(
          "An active source marker blocks archival.",
        );
      }
      if (file.detail.path.startsWith("archive/completed/")) return file.detail;
      const basename = file.detail.path.split("/").at(-1);
      if (basename === undefined)
        throw new DocumentWorkflowError("Invalid document path.");
      const targetDirectory = `${this.docsRoot}/archive/completed`;
      const target = `${targetDirectory}/${basename}`;
      if (await Bun.file(target).exists()) {
        throw new DocumentWorkflowError(
          `Archive target already exists: ${basename}`,
        );
      }
      const parsed = parseMarkdownDocument(file.raw);
      const body = appendCommentLog(
        parsed.body,
        actor,
        "Archived to `packages/docs/archive/completed/`.",
        new Date().toISOString(),
      );
      await this.atomicWrite(
        file.absolutePath,
        serializeMarkdownDocument(parsed.frontmatter, body),
      );
      await commandValue(this.repoRoot, ["mkdir", "-p", "--", targetDirectory]);
      await commandValue(this.repoRoot, [
        "mv",
        "--",
        file.absolutePath,
        target,
      ]);
      const archivedPath = `archive/completed/${basename}`;
      await this.refreshCachedPaths([file.detail.path, archivedPath]);
      const updated = await this.get(id);
      this.publishChange(id);
      return updated;
    });
  }
}
