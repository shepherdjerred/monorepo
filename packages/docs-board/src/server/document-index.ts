import { z } from "zod";

import { parseMarkdownDocument } from "#shared/markdown";
import { DocumentDetailSchema, type DocumentDetail } from "#shared/schema";

const ErrorSchema = z.instanceof(Error);

export type ParsedFile = {
  absolutePath: string;
  raw: string;
  detail: DocumentDetail;
};

export type InvalidFile = {
  path: string;
  title: string;
  errors: string[];
};

export type DocumentIndexSnapshot = {
  filesByPath: Map<string, ParsedFile | InvalidFile>;
  valid: ParsedFile[];
  validById: Map<string, ParsedFile>;
  invalid: InvalidFile[];
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

export async function readDocumentPath(
  docsRoot: string,
  path: string,
): Promise<ParsedFile | InvalidFile | null> {
  const absolutePath = `${docsRoot}/${path}`;
  const source = Bun.file(absolutePath);
  if (!(await source.exists())) return null;
  const raw = await source.text();
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
}

export function createDocumentSnapshot(
  filesByPath: Map<string, ParsedFile | InvalidFile>,
): DocumentIndexSnapshot {
  const candidates: ParsedFile[] = [];
  const invalid: InvalidFile[] = [];
  for (const file of filesByPath.values()) {
    if ("detail" in file) candidates.push(file);
    else invalid.push(file);
  }
  candidates.sort((left, right) =>
    left.detail.path.localeCompare(right.detail.path),
  );
  const groupedById = new Map<string, ParsedFile[]>();
  for (const file of candidates) {
    const group = groupedById.get(file.detail.id) ?? [];
    group.push(file);
    groupedById.set(file.detail.id, group);
  }
  const valid: ParsedFile[] = [];
  const validById = new Map<string, ParsedFile>();
  for (const [id, group] of groupedById) {
    if (group.length === 1) {
      const file = group[0];
      if (file !== undefined) {
        valid.push(file);
        validById.set(id, file);
      }
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
  invalid.sort((left, right) => left.path.localeCompare(right.path));
  return { filesByPath, valid, validById, invalid };
}
