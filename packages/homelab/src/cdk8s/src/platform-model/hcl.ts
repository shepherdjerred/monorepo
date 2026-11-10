/**
 * Just enough HCL to read the OpenTofu stacks' declarations: blocks, their
 * labels, and each block's attributes as unevaluated expression text.
 *
 * It evaluates nothing. A caller that needs a value asks for a literal
 * (`literalString`, `literalStrings`) and gets `undefined` for an expression.
 * Syntax the scanner does not know throws rather than being skipped, so a
 * stack cannot silently drop out of the checks built on it.
 */

export type HclBlock = {
  /** `resource`, `module`, `locals`, a nested block's name, ... */
  type: string;
  labels: readonly string[];
  /** Attribute name to expression text, comments removed. */
  attributes: ReadonlyMap<string, string>;
  blocks: readonly HclBlock[];
};

const HEADER = /([A-Z_][\w-]*)((?:[ \t]+"[^"\n]*")*)[ \t]*\{/iy;
const ATTRIBUTE = /([A-Z_][\w-]*|"[^"\n]*")[ \t]*=(?!=)[ \t]*/iy;
const HEREDOC = /<<-?([A-Z_]\w*)[ \t]*\n/iy;

function fail(text: string, index: number, message: string): never {
  const line = text.slice(0, index).split("\n").length;
  throw new Error(`HCL line ${String(line)}: ${message}`);
}

/** Index just past the string whose opening quote is at `index`. */
function skipString(text: string, index: number): number {
  let cursor = index + 1;
  while (cursor < text.length) {
    const char = text[cursor];
    if (char === "\\") cursor += 2;
    else if (char === '"') return cursor + 1;
    else if ((char === "$" || char === "%") && text[cursor + 1] === "{")
      cursor = skipBalanced(text, cursor + 1);
    else cursor += 1;
  }
  return fail(text, index, "unterminated string");
}

/** Index just past the heredoc starting at `index`, or `undefined` if none does. */
function skipHeredoc(text: string, index: number): number | undefined {
  HEREDOC.lastIndex = index;
  const match = HEREDOC.exec(text);
  if (match === null) return undefined;
  const terminator = new RegExp(
    String.raw`^[ \t]*${match[1] ?? ""}[ \t]*$`,
    "m",
  );
  const body = text.slice(HEREDOC.lastIndex);
  const end = terminator.exec(body);
  return end === null
    ? fail(text, index, "unterminated heredoc")
    : HEREDOC.lastIndex + end.index + end[0].length;
}

/** Index just past the comment starting at `index`, or `undefined` if none does. */
function skipComment(text: string, index: number): number | undefined {
  if (text[index] === "#" || text.startsWith("//", index)) {
    const end = text.indexOf("\n", index);
    return end === -1 ? text.length : end;
  }
  if (text.startsWith("/*", index)) {
    const end = text.indexOf("*/", index);
    return end === -1 ? fail(text, index, "unterminated comment") : end + 2;
  }
  return undefined;
}

/** Index just past the bracket matching the opening one at `index`. */
function skipBalanced(text: string, index: number): number {
  let depth = 0;
  let cursor = index;
  while (cursor < text.length) {
    const skipped = skipComment(text, cursor) ?? skipHeredoc(text, cursor);
    if (skipped !== undefined) {
      cursor = skipped;
      continue;
    }
    const char = text[cursor];
    if (char === '"') {
      cursor = skipString(text, cursor);
      continue;
    }
    if (char === "{" || char === "[" || char === "(") depth += 1;
    if (char === "}" || char === "]" || char === ")") {
      depth -= 1;
      if (depth === 0) return cursor + 1;
    }
    cursor += 1;
  }
  return fail(text, index, "unbalanced bracket");
}

/**
 * Index where the expression starting at `range.start` ends: a newline, the
 * end of the enclosing body, or inside an object expression a comma.
 */
function expressionEnd(
  text: string,
  range: { start: number; end: number },
  inObject: boolean,
): number {
  let cursor = range.start;
  while (cursor < range.end) {
    const comment = skipComment(text, cursor);
    if (comment !== undefined) {
      // A comment ends the line; a block comment may continue the expression.
      if (text[cursor] !== "/" || text[cursor + 1] !== "*") return cursor;
      cursor = comment;
      continue;
    }
    const heredoc = skipHeredoc(text, cursor);
    if (heredoc !== undefined) return heredoc;
    const char = text[cursor];
    if (char === "\n" || (inObject && char === ",")) return cursor;
    if (char === '"') cursor = skipString(text, cursor);
    else if (char === "{" || char === "[" || char === "(")
      cursor = skipBalanced(text, cursor);
    else cursor += 1;
  }
  return range.end;
}

function stripComments(expression: string): string {
  let result = "";
  let cursor = 0;
  while (cursor < expression.length) {
    const comment = skipComment(expression, cursor);
    if (comment !== undefined) {
      cursor = comment;
      continue;
    }
    const next =
      expression[cursor] === '"'
        ? skipString(expression, cursor)
        : (skipHeredoc(expression, cursor) ?? cursor + 1);
    result += expression.slice(cursor, next);
    cursor = next;
  }
  return result.trim();
}

function parseBody(
  text: string,
  range: { start: number; end: number },
  inObject = false,
): Pick<HclBlock, "attributes" | "blocks"> {
  const { start, end } = range;
  const attributes = new Map<string, string>();
  const blocks: HclBlock[] = [];
  let cursor = start;
  while (cursor < end) {
    const char = text[cursor] ?? "";
    if (/\s/.test(char) || (inObject && char === ",")) {
      cursor += 1;
      continue;
    }
    const comment = skipComment(text, cursor);
    if (comment !== undefined) {
      cursor = comment;
      continue;
    }
    ATTRIBUTE.lastIndex = cursor;
    const attribute = ATTRIBUTE.exec(text);
    if (attribute !== null) {
      const stop = expressionEnd(
        text,
        { start: ATTRIBUTE.lastIndex, end },
        inObject,
      );
      attributes.set(
        (attribute[1] ?? "").replaceAll('"', ""),
        stripComments(text.slice(ATTRIBUTE.lastIndex, stop)),
      );
      cursor = stop;
      continue;
    }
    HEADER.lastIndex = cursor;
    const header = HEADER.exec(text);
    if (header === null)
      return fail(text, cursor, "expected attribute or block");
    const open = HEADER.lastIndex - 1;
    const close = skipBalanced(text, open);
    blocks.push({
      type: header[1] ?? "",
      labels: [...(header[2] ?? "").matchAll(/"([^"]*)"/g)].map(
        (label) => label[1] ?? "",
      ),
      ...parseBody(text, { start: open + 1, end: close - 1 }),
    });
    cursor = close;
  }
  return { attributes, blocks };
}

/** The top-level blocks of one `.tf` file. */
export function parseHcl(text: string): readonly HclBlock[] {
  const { attributes, blocks } = parseBody(text, {
    start: 0,
    end: text.length,
  });
  if (attributes.size > 0)
    throw new Error(
      `HCL: unexpected top-level attribute ${[...attributes.keys()].join(", ")}`,
    );
  return blocks;
}

/** The value of a plain quoted string without interpolation, else `undefined`. */
export function literalString(
  expression: string | undefined,
): string | undefined {
  if (expression === undefined) return undefined;
  const match = /^"((?:[^"\\$%]|\\.)*)"$/.exec(expression);
  return match?.[1]?.replaceAll(/\\(.)/g, "$1");
}

/** The values of a list of plain quoted strings, else `undefined`. */
export function literalStrings(
  expression: string | undefined,
): string[] | undefined {
  if (expression === undefined || !/^\[[\s\S]*\]$/.test(expression))
    return undefined;
  const inner = expression.slice(1, -1).trim().replace(/,$/, "");
  if (inner === "") return [];
  const values = inner.split(",").map((item) => literalString(item.trim()));
  return values.every((value) => value !== undefined) ? values : undefined;
}

/**
 * The entries of an object expression (`{ key = expr, "key" = expr }`), each
 * value as expression text. `undefined` when the expression is not an object.
 */
export function objectEntries(
  expression: string | undefined,
): ReadonlyMap<string, string> | undefined {
  if (expression === undefined || !/^\{[\s\S]*\}$/.test(expression))
    return undefined;
  const body = expression.slice(1, -1);
  const { attributes, blocks } = parseBody(
    body,
    { start: 0, end: body.length },
    true,
  );
  return blocks.length > 0 ? undefined : attributes;
}
