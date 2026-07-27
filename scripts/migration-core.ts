// renovate: datasource=npm depName=pyright
export const PYRIGHT_VERSION = "1.1.411";

export function deckCommand(deck: string): string[] {
  return [
    "bunx",
    "mdanki",
    `${deck}.md`,
    `${deck}.apkg`,
    "--config",
    "settings.json",
  ];
}

export function parseConflictIgnore(source: string): string[] {
  return source
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

export function isNoopScript(command: string): boolean {
  const normalized = command.trim();
  return (
    normalized === "true" ||
    normalized === ":" ||
    normalized === "echo" ||
    normalized.startsWith("echo ") ||
    normalized.startsWith("echo\t")
  );
}

const packageNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function validatePackageName(name?: string): string {
  if (name === undefined || !packageNamePattern.test(name)) {
    throw new Error("Usage: bun scripts/new-package.ts <kebab-name>");
  }
  return name;
}

export function packageFiles(name: string): Readonly<Record<string, string>> {
  return {
    "package.json": `${JSON.stringify(
      {
        name: `@shepherdjerred/${name}`,
        version: "0.1.0",
        type: "module",
        private: true,
        scripts: {
          build: "bun build src/index.ts --outdir dist",
          test: "bun test",
          typecheck: "tsc --noEmit",
          lint: "eslint .",
        },
        devDependencies: {
          "@shepherdjerred/eslint-config": "workspace:*",
          "@types/bun": "^1.3.14",
          eslint: "^10.7.0",
          typescript: "^6.0.3",
        },
      },
      undefined,
      2,
    )}\n`,
    "eslint.config.ts": `import { recommended } from "@shepherdjerred/eslint-config";\n\nexport default recommended({ tsconfigRootDir: import.meta.dirname });\n`,
    "tsconfig.json": `${JSON.stringify(
      {
        extends: "../../tsconfig.base.json",
        compilerOptions: { outDir: "dist", rootDir: "src", noEmit: true },
        include: ["src", "*.test.ts"],
      },
      undefined,
      2,
    )}\n`,
    "src/index.ts": "export {};\n",
    "src/index.test.ts":
      'import { expect, test } from "bun:test";\n\ntest("package loads", async () => {\n  expect(await import("./index.ts")).toBeDefined();\n});\n',
  };
}

export async function existingFiles(
  paths: readonly string[],
): Promise<string[]> {
  const checks = await Promise.all(
    paths.map(async (path) => ({
      exists: await Bun.file(path).exists(),
      path,
    })),
  );
  return checks.filter(({ exists }) => exists).map(({ path }) => path);
}

export function isShellcheckCandidate(path: string): boolean {
  return !(
    path.includes("/archive/") ||
    path.includes("wasm-src/") ||
    path.includes("/Pods/") ||
    path.includes("/target/")
  );
}

export type CoverageSummary = {
  readonly functions: number;
  readonly lines: number;
};

export function parseCoverageSummaries(output: string): CoverageSummary[] {
  const summaries: CoverageSummary[] = [];
  for (const line of output.split("\n")) {
    const match =
      /All files\s+\|\s+(\d+(?:\.\d+)?)\s+\|\s+(\d+(?:\.\d+)?)\s+\|/.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      summaries.push({
        functions: Number(match[1]),
        lines: Number(match[2]),
      });
    }
  }
  return summaries;
}
