import { fail } from "./validate-pipeline-lib.ts";

function withoutHclComments(document: string): string {
  let output = "";
  let quoted = false;
  let escaped = false;
  let blockComment = false;
  let lineComment = false;

  for (let index = 0; index < document.length; index += 1) {
    const character = document.charAt(index);
    const next = document.charAt(index + 1);
    if (lineComment) {
      if (character === "\n") {
        lineComment = false;
        output += character;
      }
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        output += " ";
        index += 1;
      } else if (character === "\n") {
        output += character;
      }
      continue;
    }
    if (quoted) {
      output += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
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
    }
  }
  if (blockComment) fail("docker-bake.hcl has an unclosed block comment");
  return output;
}

export function hclStringAttribute(
  block: string,
  attribute: string,
): string | undefined {
  for (const rawLine of withoutHclComments(block).split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith(attribute)) continue;
    const assignment = line.slice(attribute.length).trimStart();
    if (!assignment.startsWith("=")) continue;
    const value = assignment.slice(1).trimStart();
    if (!value.startsWith('"')) continue;

    let escaped = false;
    for (let cursor = 1; cursor < value.length; cursor += 1) {
      const character = value[cursor];
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        const trailing = value.slice(cursor + 1).trim();
        if (trailing.length === 0) return value.slice(1, cursor);
        break;
      }
    }
  }
  return undefined;
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
