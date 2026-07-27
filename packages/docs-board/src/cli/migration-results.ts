import {
  parseLooseFrontmatter,
  serializeMarkdownDocument,
  splitFrontmatter,
} from "#shared/markdown";
import { FrontmatterSchema } from "#shared/schema";

export type MigrationResult = {
  relativePath: string;
  targetRelativePath: string;
  content: string;
  changed: boolean;
};

export function rewriteMovedOrigins(
  results: MigrationResult[],
): MigrationResult[] {
  const movedOrigins = new Map(
    results
      .filter((result) => result.relativePath !== result.targetRelativePath)
      .map((result) => [
        `packages/docs/${result.relativePath}`,
        `packages/docs/${result.targetRelativePath}`,
      ]),
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
        : movedOrigins.get(frontmatter.origin);
    if (rewrittenOrigin === undefined) return result;
    const content = serializeMarkdownDocument(
      FrontmatterSchema.parse({
        ...frontmatter,
        origin: rewrittenOrigin,
      }),
      split.body,
    );
    return {
      ...result,
      content,
      changed: content !== result.content || result.changed,
    };
  });
}
