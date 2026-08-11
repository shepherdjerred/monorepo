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
  const blockStart = new RegExp(
    String.raw`^\s*${blockType}\s+"${name}"\s*\{`,
    "mu",
  ).exec(uncommented);
  if (blockStart?.index === undefined) {
    fail(`docker-bake.hcl has no ${marker}`);
  }
  const markerOffset = blockStart[0].indexOf(blockType);
  const markerIndex = blockStart.index + markerOffset;
  const openIndex = blockStart.index + blockStart[0].lastIndexOf("{");

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
