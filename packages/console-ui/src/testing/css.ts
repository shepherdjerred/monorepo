/** One style rule or at-rule block of a stylesheet, as the checks read it. */
export type CssBlock = {
  /** The selector list or at-rule prelude, trimmed. */
  readonly prelude: string;
  /** The at-rule chain around the block, outermost first (e.g. `@media …`). */
  readonly context: readonly string[];
  /** `prop: value` pairs written directly in the block. */
  readonly declarations: readonly CssDeclaration[];
};

export type CssDeclaration = {
  readonly property: string;
  readonly value: string;
};

export function stripComments(css: string): string {
  return css.replaceAll(/\/\*[\s\S]*?\*\//g, "");
}

function declarationsOf(text: string): CssDeclaration[] {
  return text
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.includes(":"))
    .map((part) => {
      const colon = part.indexOf(":");
      return {
        property: part.slice(0, colon).trim().toLowerCase(),
        value: part.slice(colon + 1).trim(),
      };
    });
}

type Frame = { prelude: string; context: string[]; text: string };

/** Opens a block: the text since the last `;` or `}` is its prelude. */
function open(stack: Frame[], frame: Frame): void {
  const split = Math.max(
    frame.text.lastIndexOf(";"),
    frame.text.lastIndexOf("}"),
  );
  const prelude = frame.text.slice(split + 1).trim();
  frame.text = frame.text.slice(0, split + 1);
  const context = frame.prelude.startsWith("@")
    ? [...frame.context, frame.prelude]
    : frame.context;
  stack.push({ prelude, context, text: "" });
}

/** Closes the innermost block and records it. */
function close(stack: Frame[], blocks: CssBlock[]): void {
  const closed = stack.pop();
  const parent = stack.at(-1);
  if (closed === undefined || parent === undefined) return;
  blocks.push({
    prelude: closed.prelude,
    context: closed.context,
    declarations: declarationsOf(closed.text),
  });
  parent.text += ";";
}

/**
 * Splits a stylesheet into blocks. It understands nesting (at-rules and
 * native CSS nesting) and quoted strings, which is all the checks need; it
 * is not a validating parser.
 */
export function parseCss(source: string): CssBlock[] {
  const blocks: CssBlock[] = [];
  const stack: Frame[] = [{ prelude: "", context: [], text: "" }];
  let quote: string | undefined;
  for (const character of stripComments(source)) {
    const frame = stack.at(-1);
    if (frame === undefined) break;
    const structural =
      quote === undefined && (character === "{" || character === "}");
    if (structural && character === "{") open(stack, frame);
    else if (structural) close(stack, blocks);
    else frame.text += character;
    if (character === quote) quote = undefined;
    else if (quote === undefined && (character === '"' || character === "'")) {
      quote = character;
    }
  }
  return blocks;
}

/** Whether a block is a style rule (its prelude is a selector list). */
export function isStyleRule(block: CssBlock): boolean {
  return (
    !block.prelude.startsWith("@") &&
    !block.context.some((at) => /^@(?:-webkit-)?keyframes\b/.test(at))
  );
}

/** Splits on `separator` outside parentheses and brackets. */
export function splitTopLevel(text: string, separator: RegExp): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const character of text) {
    if (character === "(" || character === "[") depth += 1;
    if (character === ")" || character === "]") depth -= 1;
    if (depth === 0 && separator.test(character)) {
      parts.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter((part) => part !== "");
}

/** The selectors of a style rule's selector list. */
export function selectorsOf(block: CssBlock): string[] {
  return splitTopLevel(block.prelude, /,/);
}

/**
 * The compound a selector styles: the last one after any combinator, with
 * `:not()` and `:has()` arguments removed (they only filter the subject).
 */
export function subjectOf(selector: string): string {
  const compounds = splitTopLevel(selector, /[\s>+~]/);
  const last = compounds.at(-1) ?? "";
  return last.replaceAll(/:(?:not|has)\((?:[^()]|\([^()]*\))*\)/g, "");
}

/** Every class name in a selector. */
export function classesOf(selector: string): string[] {
  return [...selector.matchAll(/\.(-?[_a-z][\w-]*)/gi)]
    .map((match) => match[1] ?? "")
    .filter((name) => name !== "");
}
