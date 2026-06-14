import matter from "gray-matter";
import { z } from "zod";

export type NoteFrontmatter = {
  title?: string;
  tags?: string[];
};

export type Note = {
  path: string;
  title: string;
  tags: string[];
  body: string;
  mtime: Date;
};

const FrontmatterSchema = z.looseObject({
  title: z.string().optional(),
  tags: z.array(z.unknown()).optional(),
});

export function parseNote(filePath: string, content: string): Note {
  const { data, content: body } = matter(content);

  const parsed = FrontmatterSchema.safeParse(data);
  const fileName = filePath.split("/").pop() ?? filePath;

  const title = parsed.success ? (parsed.data.title ?? fileName) : fileName;
  const rawTags = parsed.success ? (parsed.data.tags ?? []) : [];
  const tags: string[] = [];
  for (const t of rawTags) {
    if (typeof t === "string") {
      tags.push(t);
    }
  }

  return {
    path: filePath,
    title,
    tags,
    body: body.trim(),
    mtime: new Date(),
  };
}

export function serializeNote(note: Note): string {
  const frontmatter: NoteFrontmatter = {};
  if (note.title !== "") {
    frontmatter.title = note.title;
  }
  if (note.tags.length > 0) {
    frontmatter.tags = note.tags;
  }

  return matter.stringify(note.body, frontmatter);
}
