import matter from "gray-matter";
import { z } from "zod";

export type ParsedFile = {
  readonly data: Record<string, unknown>;
  readonly content: string;
};

const FrontmatterDataSchema = z.record(z.unknown());

export function parseFrontmatter(raw: string): ParsedFile {
  const result = matter(raw);
  const data = FrontmatterDataSchema.parse(result.data);
  return {
    data,
    content: result.content.trim(),
  };
}

export function serializeFrontmatter(
  data: Record<string, unknown>,
  content: string,
): string {
  return (
    matter.stringify(content ? `\n${content}\n` : "\n", data).trim() + "\n"
  );
}
