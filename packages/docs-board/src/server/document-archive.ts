import type { DocumentIndexSnapshot, ParsedFile } from "#server/document-index";
import {
  parseMarkdownDocument,
  serializeMarkdownDocument,
} from "#shared/markdown";
import { FrontmatterSchema } from "#shared/schema";

type OriginUpdate = {
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
  archivedContent: string;
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

async function collectOriginUpdates(
  input: ArchiveFilesInput,
  sourceOrigin: string,
  targetOrigin: string,
): Promise<OriginUpdate[]> {
  const updates: OriginUpdate[] = [];
  for (const candidate of input.snapshot.valid) {
    if (
      candidate.detail.path === input.file.detail.path ||
      candidate.detail.frontmatter.origin !== sourceOrigin
    ) {
      continue;
    }
    const raw = await Bun.file(candidate.absolutePath).text();
    const parsed = parseMarkdownDocument(raw);
    if (parsed.frontmatter.origin !== sourceOrigin) continue;
    const frontmatter = FrontmatterSchema.parse({
      ...parsed.frontmatter,
      origin: targetOrigin,
    });
    updates.push({
      absolutePath: candidate.absolutePath,
      path: candidate.detail.path,
      raw,
      content: serializeMarkdownDocument(frontmatter, parsed.body),
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
  const originUpdates = await collectOriginUpdates(
    input,
    sourceOrigin,
    targetOrigin,
  );
  await commandValue(input.repoRoot, ["mkdir", "-p", "--", targetDirectory]);
  const appliedOriginUpdates: OriginUpdate[] = [];
  let sourceMoved = false;
  try {
    for (const update of originUpdates) {
      await atomicWrite(input.repoRoot, update.absolutePath, update.content);
      appliedOriginUpdates.push(update);
    }
    await commandValue(input.repoRoot, [
      "mv",
      "--",
      input.file.absolutePath,
      target,
    ]);
    sourceMoved = true;
    await atomicWrite(input.repoRoot, target, input.archivedContent);
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
    for (const update of appliedOriginUpdates.reverse()) {
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
  return originUpdates.map((update) => update.path);
}
