import { fail } from "./validate-pipeline-lib.ts";

type HclHeredoc = {
  readonly delimiter: string;
  readonly allowIndent: boolean;
};

function hclHeredocAt(document: string, start: number): HclHeredoc | undefined {
  if (document.charAt(start) !== "<" || document.charAt(start + 1) !== "<") {
    return undefined;
  }
  let cursor = start + 2;
  const allowIndent = document.charAt(cursor) === "-";
  if (allowIndent) cursor += 1;
  const delimiterStart = cursor;
  const first = document.charAt(cursor);
  if (!/[A-Z_a-z]/u.test(first)) return undefined;
  cursor += 1;
  while (/[-\w]/u.test(document.charAt(cursor))) cursor += 1;
  return {
    delimiter: document.slice(delimiterStart, cursor),
    allowIndent,
  };
}

function omitHeredocLine(
  document: string,
  start: number,
  heredoc: HclHeredoc,
): {
  readonly closed: boolean;
  readonly index: number;
  readonly output: string;
} {
  const lineEnd = document.indexOf("\n", start);
  const end = lineEnd === -1 ? document.length : lineEnd;
  const line = document.slice(start, end);
  const candidate = heredoc.allowIndent ? line.trimStart() : line;
  return {
    closed: candidate.trimEnd() === heredoc.delimiter,
    index: end,
    output: lineEnd === -1 ? "" : "\n",
  };
}

function consumeBlockComment(
  character: string,
  next: string,
  index: number,
): {
  readonly closed: boolean;
  readonly index: number;
  readonly output: string;
} {
  if (character === "*" && next === "/") {
    return { closed: true, index: index + 1, output: " " };
  }
  return { closed: false, index, output: character === "\n" ? character : "" };
}

function consumeQuotedCharacter(
  character: string,
  escaped: boolean,
): { readonly escaped: boolean; readonly quoted: boolean } {
  if (escaped) return { escaped: false, quoted: true };
  if (character === "\\") return { escaped: true, quoted: true };
  return { escaped: false, quoted: character !== '"' };
}

function withoutHclComments(document: string): string {
  let output = "";
  let quoted = false;
  let escaped = false;
  let blockComment = false;
  let lineComment = false;
  let heredoc: HclHeredoc | undefined;
  let pendingHeredoc: HclHeredoc | undefined;

  for (let index = 0; index < document.length; index += 1) {
    if (heredoc !== undefined) {
      const omitted = omitHeredocLine(document, index, heredoc);
      if (omitted.closed) heredoc = undefined;
      output += omitted.output;
      index = omitted.index;
      continue;
    }
    const character = document.charAt(index);
    const next = document.charAt(index + 1);
    if (lineComment) {
      if (character === "\n") {
        lineComment = false;
        output += character;
        heredoc = pendingHeredoc;
        pendingHeredoc = undefined;
      }
      continue;
    }
    if (blockComment) {
      const consumed = consumeBlockComment(character, next, index);
      blockComment = !consumed.closed;
      output += consumed.output;
      index = consumed.index;
      continue;
    }
    if (quoted) {
      output += character;
      const consumed = consumeQuotedCharacter(character, escaped);
      escaped = consumed.escaped;
      quoted = consumed.quoted;
      continue;
    }
    if (character === '"') {
      quoted = true;
      output += character;
    } else if (character === "#") {
      lineComment = true;
      output += " ";
    } else if (character === "/" && next === "/") {
      lineComment = true;
      output += " ";
      index += 1;
    } else if (character === "/" && next === "*") {
      blockComment = true;
      output += " ";
      index += 1;
    } else {
      output += character;
      pendingHeredoc ??= hclHeredocAt(document, index);
      if (character === "\n") {
        heredoc = pendingHeredoc;
        pendingHeredoc = undefined;
      }
    }
  }
  if (blockComment) fail("docker-bake.hcl has an unclosed block comment");
  if (heredoc !== undefined || pendingHeredoc !== undefined) {
    fail("docker-bake.hcl has an unclosed heredoc");
  }
  return output;
}

function isHclWhitespace(character: string): boolean {
  return (
    character === " " ||
    character === "\t" ||
    character === "\n" ||
    character === "\r"
  );
}

type HclBlockStart = {
  readonly markerIndex: number;
  readonly openIndex: number;
};

function skipHclWhitespace(document: string, start: number): number {
  let cursor = start;
  while (isHclWhitespace(document.charAt(cursor))) cursor += 1;
  return cursor;
}

function blockStartAtLine(
  document: string,
  lineStart: number,
  blockType: string,
  label: string,
): HclBlockStart | undefined {
  let cursor = lineStart;
  while (document.charAt(cursor) === " " || document.charAt(cursor) === "\t") {
    cursor += 1;
  }
  const markerIndex = cursor;
  if (!document.startsWith(blockType, cursor)) return undefined;
  cursor += blockType.length;
  if (!isHclWhitespace(document.charAt(cursor))) return undefined;
  cursor = skipHclWhitespace(document, cursor);
  if (!document.startsWith(label, cursor)) return undefined;
  cursor = skipHclWhitespace(document, cursor + label.length);
  return document.charAt(cursor) === "{"
    ? { markerIndex, openIndex: cursor }
    : undefined;
}

function namedBlockStart(
  document: string,
  blockType: string,
  name: string,
): HclBlockStart | undefined {
  const label = `"${name}"`;
  let lineStart = 0;
  while (lineStart < document.length) {
    const blockStart = blockStartAtLine(document, lineStart, blockType, label);
    if (blockStart !== undefined) return blockStart;
    const nextLine = document.indexOf("\n", lineStart);
    if (nextLine === -1) break;
    lineStart = nextLine + 1;
  }
  return undefined;
}

export function hclNamedBlock(
  document: string,
  blockType: string,
  name: string,
): string {
  if (
    !/^[a-z][a-z-]*$/.test(blockType) ||
    !/^[_a-z0-9][-_a-z0-9]*$/.test(name)
  ) {
    fail(`invalid HCL block selector ${blockType}:${name}`);
  }
  const uncommented = withoutHclComments(document);
  const marker = `${blockType} "${name}"`;
  const blockStart = namedBlockStart(uncommented, blockType, name);
  if (blockStart === undefined) {
    fail(`docker-bake.hcl has no ${marker}`);
  }
  const { markerIndex, openIndex } = blockStart;

  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = openIndex; index < uncommented.length; index += 1) {
    const character = uncommented.charAt(index);
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    switch (character) {
      case '"': {
        quoted = true;
        break;
      }
      case "{": {
        depth += 1;
        break;
      }
      case "}": {
        depth -= 1;
        if (depth === 0) return uncommented.slice(markerIndex, index + 1);
        break;
      }
    }
  }
  fail(`docker-bake.hcl ${marker} has an unclosed body`);
}
