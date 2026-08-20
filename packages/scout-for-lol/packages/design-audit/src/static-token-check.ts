import path from "node:path";

type TokenName = "brand" | "accent" | "success" | "warning" | "danger" | "info";

type OpenElement = {
  name: string;
  hasBackground: boolean;
};

export type InvalidTokenPair = {
  file: string;
  line: number;
  token: TokenName;
  source: string;
};

const tokens: readonly TokenName[] = [
  "brand",
  "accent",
  "success",
  "warning",
  "danger",
  "info",
];

function lineNumber(source: string, offset: number): number {
  return source.slice(0, offset).split("\n").length;
}

function closeElement(elements: OpenElement[], name: string): void {
  for (let index = elements.length - 1; index >= 0; index -= 1) {
    if (elements[index]?.name !== name) continue;
    elements.splice(index, 1);
    return;
  }
}

export function findInvalidTokenPairs(
  source: string,
  file: string,
): InvalidTokenPair[] {
  const findings: InvalidTokenPair[] = [];
  const seen = new Set<string>();
  const addFinding = (token: TokenName, offset: number): void => {
    const key = `${token}:${String(offset)}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({
      file,
      line: lineNumber(source, offset),
      token,
      source: source
        .slice(Math.max(0, offset - 100), offset + 140)
        .replaceAll("\n", " "),
    });
  };

  for (const token of tokens) {
    const foreground = new RegExp(
      String.raw`\btext-scout-${token}(?!-ink)(?:\/[0-9]+)?\b`,
      "g",
    );
    const backgroundOnLine = new RegExp(
      String.raw`\bbg-scout-${token}(?![/\w-])`,
    );
    const elements = /<\/?([a-z][a-z0-9-]*)\b[^<>]*>/gi;
    const openElements: OpenElement[] = [];
    for (const match of source.matchAll(elements)) {
      const tag = match[0];
      const name = match[1];
      if (name === undefined) continue;
      if (tag.startsWith("</")) {
        closeElement(openElements, name);
        continue;
      }
      foreground.lastIndex = 0;
      const hasBackground = backgroundOnLine.test(tag);
      const hasForeground = foreground.test(tag);
      if (
        hasForeground &&
        (hasBackground || openElements.some((element) => element.hasBackground))
      ) {
        addFinding(token, match.index);
      }
      if (!tag.endsWith("/>")) {
        openElements.push({ name, hasBackground });
      }
    }

    const fieldPair = new RegExp(
      String.raw`\bbg: "bg-scout-${token}[ \t]*"[\s\S]{0,180}?(?:title|titleText|text): "text-scout-${token}(?!-ink)`,
    );
    const fieldMatch = fieldPair.exec(source);
    if (fieldMatch !== null) {
      addFinding(token, fieldMatch.index);
    }
  }
  return findings;
}

async function sourceFiles(): Promise<string[]> {
  const root = path.resolve(import.meta.dir, "../..");
  const files: string[] = [];
  for (const directory of ["frontend/src", "app/src", "docs-site/src"]) {
    const glob = new Bun.Glob("**/*.{astro,ts,tsx,md,mdx}");
    for await (const relative of glob.scan({
      cwd: path.join(root, directory),
      absolute: true,
    })) {
      files.push(relative);
    }
  }
  return files;
}

if (import.meta.main) {
  const findings: InvalidTokenPair[] = [];
  for (const file of await sourceFiles()) {
    findings.push(...findInvalidTokenPairs(await Bun.file(file).text(), file));
  }
  if (findings.length > 0) {
    for (const finding of findings) {
      console.error(
        `${finding.file}:${String(finding.line)} uses text-scout-${finding.token} with bg-scout-${finding.token}: ${finding.source}`,
      );
    }
    throw new Error(
      `Found ${String(findings.length)} invalid Scout token pair(s)`,
    );
  }
  console.log("Scout semantic foreground/background token check passed");
}
