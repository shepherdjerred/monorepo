import { fail } from "./validate-pipeline-lib.ts";

const monorepoSource = "https://github.com/shepherdjerred/monorepo";
const sourceLabel = "org.opencontainers.image.source";

function dockerfileInstructions(dockerfile: string): string[] {
  const instructions: string[] = [];
  let pending = "";
  for (const line of dockerfile.split("\n")) {
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
