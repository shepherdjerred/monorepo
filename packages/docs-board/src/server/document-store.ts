import { z } from "zod";

import {
  parseMarkdownDocument,
  serializeMarkdownDocument,
} from "#shared/markdown";
import {
  DocumentDetailSchema,
  DocumentListResponseSchema,
  FrontmatterSchema,
  type DocumentDetail,
  type DocumentChange,
  type DocumentListResponse,
  type DocumentStatus,
  type DocumentSummary,
} from "#shared/schema";

const ErrorSchema = z.instanceof(Error);

export class DocumentNotFoundError extends Error {}
export class DocumentConflictError extends Error {}
export class DocumentWorkflowError extends Error {}

type ParsedFile = {
  absolutePath: string;
  raw: string;
  detail: DocumentDetail;
};

type InvalidFile = {
  path: string;
  title: string;
  errors: string[];
};

type ScanResult = {
  valid: ParsedFile[];
  invalid: InvalidFile[];
};

type StoreOptions = {
  repoRoot: string;
  watchFiles?: boolean;
};

type StatusChange = {
  revision: string;
  status: DocumentStatus;
  actor: string;
  note?: string | undefined;
};

function errorMessage(error: unknown): string {
  const result = ErrorSchema.safeParse(error);
  return result.success ? result.data.message : "unknown document error";
}

function titleFromPath(path: string): string {
  const basename = path.split("/").at(-1)?.replace(/\.md$/u, "");
  return (basename ?? path).replaceAll("_", " ").replaceAll("-", " ");
}

function revisionFor(raw: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(raw);
  return hasher.digest("hex");
}

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
  private watchTimer: ReturnType<typeof setInterval> | null = null;
  private watchSignature = "";
  private watching = false;

  constructor(options: StoreOptions) {
    this.repoRoot = options.repoRoot;
    this.docsRoot = `${options.repoRoot}/packages/docs`;
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

  private startWatcher(): void {
    const poll = (): void => {
      if (this.watching) return;
      this.watching = true;
      try {
        const glob = new Bun.Glob("**/*.md");
        const paths = [
          ...glob.scanSync({ cwd: this.docsRoot, onlyFiles: true }),
        ].sort();
        const signatures = paths.map((path) => {
          const file = Bun.file(`${this.docsRoot}/${path}`);
          return `${path}:${String(file.size)}:${String(file.lastModified)}`;
        });
        const signature = signatures.join("|");
        if (this.watchSignature !== "" && signature !== this.watchSignature) {
          this.publishChange(null);
        }
        this.watchSignature = signature;
      } catch (error) {
        console.error("docs watcher failed", error);
      } finally {
        this.watching = false;
      }
    };
    poll();
    this.watchTimer = setInterval(poll, 1000);
  }

  private async scan(): Promise<ScanResult> {
    const glob = new Bun.Glob("**/*.md");
    const paths = [
      ...glob.scanSync({ cwd: this.docsRoot, onlyFiles: true }),
    ].sort();
    const files = await Promise.all(
      paths.map(async (path): Promise<ParsedFile | InvalidFile> => {
        const absolutePath = `${this.docsRoot}/${path}`;
        const raw = await Bun.file(absolutePath).text();
        try {
          const parsed = parseMarkdownDocument(raw);
          const detail = DocumentDetailSchema.parse({
            id: parsed.frontmatter.id,
            path,
            title: parsed.metadata.title ?? titleFromPath(path),
            type: parsed.frontmatter.type,
            status: parsed.frontmatter.status,
            board: parsed.frontmatter.board,
            verification: parsed.frontmatter.verification ?? null,
            disposition: parsed.frontmatter.disposition ?? null,
            remainingCount: parsed.metadata.remainingCount,
            hasHumanVerification: parsed.metadata.hasHumanVerification,
            commentCount: parsed.metadata.commentCount,
            lastActivity: parsed.metadata.lastActivity,
            revision: revisionFor(raw),
            markdown: parsed.body,
            frontmatter: parsed.frontmatter,
            workflow: parsed.metadata.workflow,
          });
          return { absolutePath, raw, detail };
        } catch (error) {
          return {
            path,
            title: titleFromPath(path),
            errors: [errorMessage(error)],
          };
        }
      }),
    );
    const valid: ParsedFile[] = [];
    const invalid: InvalidFile[] = [];
    for (const file of files) {
      if ("detail" in file) valid.push(file);
      else invalid.push(file);
    }
    const byId = new Map<string, ParsedFile[]>();
    for (const file of valid) {
      const group = byId.get(file.detail.id) ?? [];
      group.push(file);
      byId.set(file.detail.id, group);
    }
    const unique: ParsedFile[] = [];
    for (const [id, group] of byId) {
      if (group.length === 1) {
        const file = group[0];
        if (file !== undefined) unique.push(file);
        continue;
      }
      for (const file of group) {
        invalid.push({
          path: file.detail.path,
          title: file.detail.title,
          errors: [`duplicate document id '${id}'`],
        });
      }
    }
    return { valid: unique, invalid };
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
    const file = scan.valid.find((candidate) => candidate.detail.id === id);
    if (file === undefined) throw new DocumentNotFoundError(id);
    return file;
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
    const initial = await this.getFile(id);
    return this.withWriteQueue(initial.absolutePath, async () => {
      const file = await this.getFile(id);
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
    const initial = await this.getFile(id);
    return this.withWriteQueue(initial.absolutePath, async () => {
      const file = await this.getFile(id);
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
    const initial = await this.getFile(id);
    return this.withWriteQueue(initial.absolutePath, async () => {
      const file = await this.getFile(id);
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
      const updated = await this.get(id);
      this.publishChange(id);
      return updated;
    });
  }
}
