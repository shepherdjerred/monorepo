import { fail } from "./validate-pipeline-lib.ts";

const monorepoSource = "https://github.com/shepherdjerred/monorepo";
const sourceLabel = "org.opencontainers.image.source";

type Heredoc = {
  readonly delimiter: string;
  readonly stripTabs: boolean;
};

function instructionHeredocs(instruction: string): Heredoc[] {
  const heredocs: Heredoc[] = [];
  let offset = 0;

  while (offset < instruction.length) {
    const operator = instruction.indexOf("<<", offset);
    if (operator === -1) break;

    let cursor = operator + 2;
    const stripTabs = instruction[cursor] === "-";
    if (stripTabs) cursor += 1;
    while (instruction[cursor] === " " || instruction[cursor] === "\t") {
      cursor += 1;
    }

    const quote = instruction[cursor];
    let delimiter = "";
    if (quote === '"' || quote === "'") {
      cursor += 1;
      const closingQuote = instruction.indexOf(quote, cursor);
      if (closingQuote !== -1) {
        delimiter = instruction.slice(cursor, closingQuote);
        cursor = closingQuote + 1;
      }
    } else {
      const start = cursor;
      while (cursor < instruction.length) {
        const character = instruction[cursor];
        if (
          character === " " ||
          character === "\t" ||
          character === "\r" ||
          character === "\n" ||
          character === '"' ||
          character === "'" ||
          character === "<" ||
          character === ">"
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

function dockerfileInstructions(dockerfile: string): string[] {
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
    const continues = trimmed.endsWith("\\");
    const part = continues ? trimmed.slice(0, -1).trimEnd() : trimmed;
    pending = pending.length === 0 ? part : `${pending} ${part}`;
    if (!continues) {
      instructions.push(pending);
      heredocs = instructionHeredocs(pending);
      pending = "";
    }
  }
  if (pending.length > 0) instructions.push(pending);
  return instructions;
}

function labelWords(body: string): string[] {
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
    if (character === "\\" && quote !== "'") {
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
  if (escaped) current += "\\";
  if (current.length > 0) words.push(current);
  return words;
}

function sourceLabelValues(instruction: string): string[] {
  const prefix = "LABEL ";
  if (!instruction.toUpperCase().startsWith(prefix)) return [];
  const words = labelWords(instruction.slice(prefix.length));
  const values = words.flatMap((word) => {
    const separator = word.indexOf("=");
    return separator !== -1 && word.slice(0, separator) === sourceLabel
      ? [word.slice(separator + 1)]
      : [];
  });
  if (values.length > 0) return values;
  return words[0] === sourceLabel ? [words.slice(1).join(" ")] : [];
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
  for (const instruction of dockerfileInstructions(dockerfile)) {
    const from = /^FROM\s+(\S+)(?:\s+AS\s+(\S+))?\s*$/iu.exec(instruction);
    if (from !== null) {
      const base = from[1];
      const name = from[2];
      const inherited = stages.findLast(
        (stage) =>
          base !== undefined &&
          stage.name?.toLowerCase() === base.toLowerCase(),
      );
      currentStage = { name, sourceLabel: inherited?.sourceLabel ?? false };
      stages.push(currentStage);
      continue;
    }
    for (const value of sourceLabelValues(instruction)) {
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
