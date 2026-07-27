import {
  parseLooseFrontmatter,
  serializeMarkdownDocument,
  splitFrontmatter,
} from "#shared/markdown";
import { rewriteDocumentLinks } from "#lib/document-links";
import { FrontmatterSchema } from "#shared/schema";

export type MigrationResult = {
  relativePath: string;
  targetRelativePath: string;
  content: string;
  changed: boolean;
};

export function rewriteMovedReferences(
  results: MigrationResult[],
): MigrationResult[] {
  const movedPaths = new Map(
    results
      .filter((result) => result.relativePath !== result.targetRelativePath)
      .map((result) => [result.relativePath, result.targetRelativePath]),
  );
  return results.map((result) => {
    const split = splitFrontmatter(result.content);
    if (split === null)
      throw new Error(`${result.relativePath}: no frontmatter`);
    const frontmatter = FrontmatterSchema.parse(
      parseLooseFrontmatter(split.yaml),
    );
    const rewrittenOrigin =
      frontmatter.origin === undefined
        ? undefined
        : movedPaths.get(frontmatter.origin.replace(/^packages\/docs\//u, ""));
    const body = rewriteDocumentLinks(
      split.body,
      result.relativePath,
      result.targetRelativePath,
      movedPaths,
    );
    if (rewrittenOrigin === undefined && body === split.body) return result;
    const content = serializeMarkdownDocument(
      rewrittenOrigin === undefined
        ? frontmatter
        : FrontmatterSchema.parse({
            ...frontmatter,
            origin: `packages/docs/${rewrittenOrigin}`,
          }),
      body,
    );
    return {
      ...result,
      content,
      changed: content !== result.content || result.changed,
    };
  });
}
