import type { DocumentIndexSnapshot, ParsedFile } from "#server/document-index";
import { rewriteDocumentLinks } from "#lib/document-links";
import {
  parseMarkdownDocument,
  serializeMarkdownDocument,
} from "#shared/markdown";
import { FrontmatterSchema, type DocumentFrontmatter } from "#shared/schema";

type ReferenceUpdate = {
  absolutePath: string;
  path: string;
  raw: string;
  content: string;
};

type ArchiveFilesInput = {
  repoRoot: string;
  docsRoot: string;
  file: ParsedFile;
  archivedPath: string;
  archivedFrontmatter: DocumentFrontmatter;
  archivedBody: string;
  snapshot: DocumentIndexSnapshot;
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

export async function atomicWrite(
  repoRoot: string,
  path: string,
  content: string,
): Promise<void> {
  const temporaryPath = `${path}.docs-board-${crypto.randomUUID()}.tmp`;
  await Bun.write(temporaryPath, content);
  try {
    await commandValue(repoRoot, ["mv", "--", temporaryPath, path]);
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

async function collectReferenceUpdates(
  input: ArchiveFilesInput,
  sourceOrigin: string,
  targetOrigin: string,
  movedPaths: ReadonlyMap<string, string>,
): Promise<ReferenceUpdate[]> {
  const updates: ReferenceUpdate[] = [];
  for (const candidate of input.snapshot.valid) {
    if (candidate.detail.path === input.file.detail.path) continue;
    const raw = await Bun.file(candidate.absolutePath).text();
    const parsed = parseMarkdownDocument(raw);
    const frontmatter =
      parsed.frontmatter.origin === sourceOrigin
        ? FrontmatterSchema.parse({
            ...parsed.frontmatter,
            origin: targetOrigin,
          })
        : parsed.frontmatter;
    const body = rewriteDocumentLinks(
      parsed.body,
      candidate.detail.path,
      candidate.detail.path,
      movedPaths,
    );
    if (frontmatter === parsed.frontmatter && body === parsed.body) continue;
    updates.push({
      absolutePath: candidate.absolutePath,
      path: candidate.detail.path,
      raw,
      content: serializeMarkdownDocument(frontmatter, body),
    });
  }
  return updates;
}

export async function archiveDocumentFiles(
  input: ArchiveFilesInput,
): Promise<string[]> {
  const targetDirectory = `${input.docsRoot}/archive/completed`;
  const target = `${input.docsRoot}/${input.archivedPath}`;
  const sourceOrigin = `packages/docs/${input.file.detail.path}`;
  const targetOrigin = `packages/docs/${input.archivedPath}`;
  const movedPaths = new Map([[input.file.detail.path, input.archivedPath]]);
  const archivedContent = serializeMarkdownDocument(
    input.archivedFrontmatter,
    rewriteDocumentLinks(
      input.archivedBody,
      input.file.detail.path,
      input.archivedPath,
      movedPaths,
    ),
  );
  const referenceUpdates = await collectReferenceUpdates(
    input,
    sourceOrigin,
    targetOrigin,
    movedPaths,
  );
  await commandValue(input.repoRoot, ["mkdir", "-p", "--", targetDirectory]);
  const appliedReferenceUpdates: ReferenceUpdate[] = [];
  let sourceMoved = false;
  try {
    for (const update of referenceUpdates) {
      await atomicWrite(input.repoRoot, update.absolutePath, update.content);
      appliedReferenceUpdates.push(update);
    }
    await commandValue(input.repoRoot, [
      "mv",
      "--",
      input.file.absolutePath,
      target,
    ]);
    sourceMoved = true;
    await atomicWrite(input.repoRoot, target, archivedContent);
  } catch (archiveError) {
    const restoreErrors: unknown[] = [];
    if (sourceMoved) {
      try {
        await commandValue(input.repoRoot, [
          "mv",
          "--",
          target,
          input.file.absolutePath,
        ]);
      } catch (restoreError) {
        restoreErrors.push(restoreError);
      }
    }
    for (const update of appliedReferenceUpdates.reverse()) {
      try {
        await atomicWrite(input.repoRoot, update.absolutePath, update.raw);
      } catch (restoreError) {
        restoreErrors.push(restoreError);
      }
    }
    if (restoreErrors.length > 0) {
      throw new AggregateError(
        [archiveError, ...restoreErrors],
        "Archival failed and its provenance changes could not be restored.",
        { cause: archiveError },
      );
    }
    throw archiveError;
  }
  return referenceUpdates.map((update) => update.path);
}
