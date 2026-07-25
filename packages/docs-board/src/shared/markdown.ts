import type { Heading, Root } from "mdast";
import { toString } from "mdast-util-to-string";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import { parseDocument, stringify } from "yaml";
import { z } from "zod";

import {
  FrontmatterSchema,
  WorkflowSectionsSchema,
  type DocumentFrontmatter,
  type WorkflowSections,
} from "#shared/schema";

const LooseObjectSchema = z.record(z.string(), z.unknown());

export type MarkdownHeading = {
  depth: number;
  text: string;
  startLine: number;
  endLine: number;
};

export type MarkdownMetadata = {
  title: string | null;
  h1Count: number;
  headings: MarkdownHeading[];
  hasRemaining: boolean;
  remainingCount: number;
  hasHumanVerification: boolean;
  commentCount: number;
  lastActivity: string | null;
  workflow: WorkflowSections;
};

export type ParsedMarkdownDocument = {
  frontmatter: DocumentFrontmatter;
  body: string;
  metadata: MarkdownMetadata;
};

export type SplitMarkdown = {
  yaml: string;
  body: string;
};

export function splitFrontmatter(raw: string): SplitMarkdown | null {
  if (!raw.startsWith("---\n")) return null;
  const end = raw.indexOf("\n---\n", 4);
  if (end === -1) return null;
  return {
    yaml: raw.slice(4, end),
    body: raw.slice(end + 5),
  };
}

export function parseLooseFrontmatter(yaml: string): Record<string, unknown> {
  const document = parseDocument(yaml);
  if (document.errors.length > 0) {
    throw new Error(document.errors.map((error) => error.message).join("; "));
  }
  const value: unknown = document.toJS();
  return LooseObjectSchema.parse(value);
}

export function parseMarkdownBody(body: string): MarkdownMetadata {
  const tree: Root = unified().use(remarkParse).use(remarkGfm).parse(body);
  const headings: MarkdownHeading[] = [];
  let title: string | null = null;
  let h1Count = 0;

  visit(tree, "heading", (heading: Heading) => {
    const startLine = heading.position?.start.line;
    const endLine = heading.position?.end.line;
    if (startLine === undefined || endLine === undefined) return;
    const text = toString(heading).trim();
    headings.push({ depth: heading.depth, text, startLine, endLine });
    if (heading.depth === 1) {
      h1Count += 1;
      title ??= text;
    }
  });

  const remaining = findSection(headings, "Remaining");
  const humanVerification = findSection(headings, "Human Verification");
  const commentLog = findSection(headings, "Comment Log");
  let remainingCount = 0;
  let commentCount = 0;
  let lastActivity: string | null = null;

  visit(tree, "listItem", (item) => {
    const line = item.position?.start.line;
    if (line === undefined) return;
    if (
      remaining !== null &&
      line > remaining.start &&
      line < remaining.end &&
      item.checked === false
    )
      remainingCount += 1;
  });

  if (commentLog !== null) {
    const commentHeadings = headings.filter(
      (heading) =>
        heading.depth === 3 &&
        heading.startLine > commentLog.start &&
        heading.startLine < commentLog.end,
    );
    commentCount = commentHeadings.length;
    lastActivity = commentHeadings.at(-1)?.text ?? null;
  }

  return {
    title,
    h1Count,
    headings,
    hasRemaining: remaining !== null,
    remainingCount,
    hasHumanVerification: humanVerification !== null,
    commentCount,
    lastActivity,
    workflow: WorkflowSectionsSchema.parse({
      humanVerificationMarkdown: sectionMarkdown(
        body,
        headings,
        "Human Verification",
      ),
      remainingMarkdown: sectionMarkdown(body, headings, "Remaining"),
      commentLogMarkdown: sectionMarkdown(body, headings, "Comment Log"),
    }),
  };
}

export function sectionMarkdown(
  body: string,
  headings: MarkdownHeading[],
  name: string,
): string | null {
  const section = findSection(headings, name);
  if (section === null) return null;
  const lines = body.split("\n");
  const end = Number.isFinite(section.end) ? section.end - 1 : lines.length;
  return lines.slice(section.start, end).join("\n").trim();
}

export function parseMarkdownDocument(raw: string): ParsedMarkdownDocument {
  const split = splitFrontmatter(raw);
  if (split === null) throw new Error("missing YAML frontmatter");
  const frontmatter = FrontmatterSchema.parse(
    parseLooseFrontmatter(split.yaml),
  );
  return {
    frontmatter,
    body: split.body,
    metadata: parseMarkdownBody(split.body),
  };
}

export function serializeMarkdownDocument(
  frontmatter: DocumentFrontmatter,
  body: string,
): string {
  const canonical: Record<string, unknown> = {
    id: frontmatter.id,
    type: frontmatter.type,
    status: frontmatter.status,
    board: frontmatter.board,
  };
  if (frontmatter.verification !== undefined) {
    canonical["verification"] = frontmatter.verification;
  }
  if (frontmatter.disposition !== undefined) {
    canonical["disposition"] = frontmatter.disposition;
  }
  if (frontmatter.origin !== undefined) {
    canonical["origin"] = frontmatter.origin;
  }
  if (frontmatter.source_marker !== undefined) {
    canonical["source_marker"] = frontmatter.source_marker;
  }
  const canonicalKeys = new Set(Object.keys(canonical));
  for (const [key, value] of Object.entries(frontmatter)) {
    if (!canonicalKeys.has(key)) canonical[key] = value;
  }
  return `---\n${stringify(canonical, { lineWidth: 0 }).trimEnd()}\n---\n\n${body.trimStart().trimEnd()}\n`;
}

export function findSection(
  headings: MarkdownHeading[],
  name: string,
): { start: number; end: number } | null {
  const index = headings.findIndex(
    (heading) => heading.depth === 2 && heading.text === name,
  );
  if (index === -1) return null;
  const heading = headings[index];
  if (heading === undefined) return null;
  const next = headings
    .slice(index + 1)
    .find((candidate) => candidate.depth <= heading.depth);
  return {
    start: heading.endLine,
    end: next?.startLine ?? Number.POSITIVE_INFINITY,
  };
}
