import { fail } from "./validate-pipeline-lib.ts";

const monorepoSource = "https://github.com/shepherdjerred/monorepo";
const sourceLabel = "org.opencontainers.image.source";

type Heredoc = {
  readonly delimiter: string;
  readonly stripTabs: boolean;
};

function dockerfileEscape(dockerfile: string): "\\" | "`" {
  for (const rawLine of dockerfile.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (!line.startsWith("#")) return "\\";
    const body = line.slice(1).trim();
    const separator = body.indexOf("=");
    if (separator === -1) return "\\";

    const name = body.slice(0, separator).trim().toLowerCase();
    const value = body.slice(separator + 1).trim();
    if (name === "escape") {
      return value === "`" ? "`" : "\\";
    }
    if (name !== "syntax" && name !== "check") return "\\";
  }
  return "\\";
}

function nextHeredocOperator(
  instruction: string,
  start: number,
  escapeCharacter: "\\" | "`",
): number {
  let quote: "'" | '"' | undefined;
  let escaped = false;
  for (let cursor = start; cursor < instruction.length; cursor += 1) {
    const character = instruction[cursor];
    if (escaped) {
      escaped = false;
    } else if (character === escapeCharacter && quote !== "'") {
      escaped = true;
    } else if (quote !== undefined) {
      if (character === quote) quote = undefined;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "<" && instruction[cursor + 1] === "<") {
      return cursor;
    }
  }
  return -1;
}

function instructionHeredocs(
  instruction: string,
  escapeCharacter: "\\" | "`",
): Heredoc[] {
  const heredocs: Heredoc[] = [];
  let offset = 0;

  while (offset < instruction.length) {
    const operator = nextHeredocOperator(instruction, offset, escapeCharacter);
    if (operator === -1) break;
    let cursor = operator + 2;
    const stripTabs = instruction[cursor] === "-";
    if (stripTabs) cursor += 1;
    while (instruction[cursor] === " " || instruction[cursor] === "\t") {
      cursor += 1;
    }

    const delimiterQuote = instruction[cursor];
    let delimiter = "";
    if (delimiterQuote === '"' || delimiterQuote === "'") {
      cursor += 1;
      const closingQuote = instruction.indexOf(delimiterQuote, cursor);
      if (closingQuote !== -1) {
        delimiter = instruction.slice(cursor, closingQuote);
        cursor = closingQuote + 1;
      }
    } else {
      const start = cursor;
      while (cursor < instruction.length) {
        const delimiterCharacter = instruction[cursor];
        if (
          delimiterCharacter === " " ||
          delimiterCharacter === "\t" ||
          delimiterCharacter === "\r" ||
          delimiterCharacter === "\n" ||
          delimiterCharacter === '"' ||
          delimiterCharacter === "'" ||
          delimiterCharacter === "<" ||
          delimiterCharacter === ">"
        ) {
          break;
        }
        cursor += 1;
      }
      delimiter = instruction.slice(start, cursor);
    }

    if (delimiter.length > 0) heredocs.push({ delimiter, stripTabs });
    offset = Math.max(cursor, operator + 2);
  }

  return heredocs;
}

function canContainHeredoc(instruction: string): boolean {
  const words = instruction.trimStart().split(/\s+/u);
  const topLevel = words[0]?.toUpperCase();
  const opcode = topLevel === "ONBUILD" ? words[1]?.toUpperCase() : topLevel;
  return opcode === "ADD" || opcode === "COPY" || opcode === "RUN";
}

function dockerfileInstructions(
  dockerfile: string,
  escape: "\\" | "`",
): string[] {
  const instructions: string[] = [];
  let heredocs: Heredoc[] = [];
  let pending = "";
  for (const rawLine of dockerfile.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    const heredoc = heredocs[0];
    if (heredoc !== undefined) {
      const candidate = heredoc.stripTabs ? line.replace(/^\t+/u, "") : line;
      if (candidate === heredoc.delimiter) heredocs = heredocs.slice(1);
      continue;
    }
    const trimmed = line.trim();
    if (
      pending.length === 0 &&
      (trimmed.length === 0 || trimmed.startsWith("#"))
    ) {
      continue;
    }
    const continues = trimmed.endsWith(escape);
    const part = continues ? trimmed.slice(0, -1).trimEnd() : trimmed;
    pending = pending.length === 0 ? part : `${pending} ${part}`;
    if (!continues) {
      instructions.push(pending);
      heredocs = canContainHeredoc(pending)
        ? instructionHeredocs(pending, escape)
        : [];
      pending = "";
    }
  }
  if (pending.length > 0) instructions.push(pending);
  return instructions;
}

function labelWords(body: string, escapeCharacter: "\\" | "`"): string[] {
  const words: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  let escaped = false;
  for (const character of body) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === escapeCharacter && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote !== undefined) {
      if (character === quote) quote = undefined;
      else current += character;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (/\s/u.test(character)) {
      if (current.length > 0) {
        words.push(current);
        current = "";
      }
    } else {
      current += character;
    }
  }
  if (escaped) current += escapeCharacter;
  if (current.length > 0) words.push(current);
  return words;
}

function sourceLabelValues(instruction: string, escape: "\\" | "`"): string[] {
  const instructionSeparator = instruction.search(/\s/u);
  if (
    instructionSeparator === -1 ||
    instruction.slice(0, instructionSeparator).toUpperCase() !== "LABEL"
  ) {
    return [];
  }
  const words = labelWords(
    instruction.slice(instructionSeparator).trimStart(),
    escape,
  );
  const values = words.flatMap((word) => {
    const separator = word.indexOf("=");
    return separator !== -1 && word.slice(0, separator) === sourceLabel
      ? [word.slice(separator + 1)]
      : [];
  });
  if (values.length > 0) return values;
  return words[0] === sourceLabel ? [words.slice(1).join(" ")] : [];
}

function fromStage(
  instruction: string,
): { readonly base: string; readonly name: string | undefined } | undefined {
  const words = instruction.trim().split(/\s+/u);
  if (words[0]?.toUpperCase() !== "FROM") return undefined;

  let cursor = 1;
  while (words[cursor]?.startsWith("--") === true) cursor += 1;
  const base = words[cursor];
  if (base === undefined)
    fail(`cannot parse Dockerfile instruction: ${instruction}`);
  cursor += 1;

  let name: string | undefined;
  if (words[cursor]?.toUpperCase() === "AS") {
    name = words[cursor + 1];
    cursor += 2;
  }
  if (cursor !== words.length) {
    fail(`cannot parse Dockerfile instruction: ${instruction}`);
  }
  return { base, name };
}

export function assertMonorepoSourceLabel(
  dockerfile: string,
  image: string,
  publishedStage: string,
): void {
  const stages: {
    readonly name: string | undefined;
    sourceLabel: boolean;
  }[] = [];
  let currentStage:
    | {
        readonly name: string | undefined;
        sourceLabel: boolean;
      }
    | undefined;
  const escape = dockerfileEscape(dockerfile);
  for (const instruction of dockerfileInstructions(dockerfile, escape)) {
    const from = fromStage(instruction);
    if (from !== undefined) {
      const { base, name } = from;
      const inherited = stages.findLast(
        (stage) => stage.name?.toLowerCase() === base.toLowerCase(),
      );
      currentStage = { name, sourceLabel: inherited?.sourceLabel ?? false };
      stages.push(currentStage);
      continue;
    }
    for (const value of sourceLabelValues(instruction, escape)) {
      if (currentStage !== undefined) {
        currentStage.sourceLabel = value === monorepoSource;
      }
    }
  }
  const published = stages.findLast(
    (stage) => stage.name?.toLowerCase() === publishedStage.toLowerCase(),
  );
  if (published === undefined) {
    fail(`${image} Dockerfile has no published ${publishedStage} stage`);
  }
  if (!published.sourceLabel) {
    fail(
      `${image} published ${publishedStage} stage must link its GHCR package to the public monorepo`,
    );
  }
}
