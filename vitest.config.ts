import path from "node:path";
import { readFile } from "node:fs/promises";

const defaultTestInclude = ["**/*.{test,spec}.?(c|m)[jt]s?(x)"];
const defaultTestExclude = ["**/node_modules/**", "**/.git/**"];

const repositoryRoot = __dirname;
const workspaceRoot = process.cwd();
const workspace = path
  .relative(repositoryRoot, workspaceRoot)
  .split(path.sep)
  .join("/");
const setupFiles =
  workspace === "packages/birmel"
    ? [path.join(workspaceRoot, "tests/setup.ts")]
    : workspace === "packages/streambot"
      ? [path.join(workspaceRoot, "test/setup.ts")]
      : workspace === "packages/cooklang-for-obsidian"
        ? [path.join(workspaceRoot, "test/setup.ts")]
        : workspace === "packages/scout-for-lol"
          ? [path.join(workspaceRoot, "packages/backend/test-setup.ts")]
          : workspace === "packages/scout-for-lol/packages/backend"
            ? [path.join(workspaceRoot, "test-setup.ts")]
            : workspace === "packages/scout-for-lol/packages/design-system"
              ? [path.join(workspaceRoot, "src/testing/setup.ts")]
              : [];

const coverageThresholds =
  process.env["CI_TEST_COVERAGE"] === "1"
    ? { lines: 0, functions: 0, statements: 0 }
    : workspace === "packages/birmel"
      ? {
          // Bun's 50% threshold counted the test implementation in coverage.
          // Vitest always excludes discovered test files, so 40% retains a
          // stricter production-code-only floor than the previous Bun result.
          lines: 40,
        }
      : workspace === "packages/scout-for-lol" ||
          workspace === "packages/scout-for-lol/packages/backend"
        ? { lines: 70, functions: 70 }
        : undefined;

const coverageExclusions =
  workspace === "packages/scout-for-lol"
    ? [
        "**/generated/**",
        "**/*.test.ts",
        "**/*.integration.test.ts",
        "**/node_modules/**",
        "**/__tests__/**",
        "**/dist/**",
        // Scope this to Scout's package tree: Buildkite checks out the
        // repository below /workspace/build, so an unanchored **/build/**
        // excludes every source file and produces an empty coverage report.
        path.join(workspaceRoot, "packages", "**", "build", "**"),
      ]
    : workspace === "packages/scout-for-lol/packages/backend"
      ? [
          "**/generated/**",
          "**/*.test.ts",
          "**/*.integration.test.ts",
          "**/node_modules/**",
          "**/__tests__/**",
        ]
      : ["**/node_modules/**"];

function replaceBunImportMetaDir(code: string, filename: string): string {
  const directory = JSON.stringify(path.dirname(filename));
  const filePath = JSON.stringify(filename);
  code = code.replaceAll(
    /\$\{import\.meta\.(?:dirname|dir)\}/g,
    `\${${directory}}`,
  );
  code = code.replaceAll(/\$\{import\.meta\.path\}/g, `\${${filePath}}`);
  let output = "";
  let index = 0;
  let quote: '"' | "'" | "`" | undefined;
  let lineComment = false;
  let blockComment = false;
  while (index < code.length) {
    const character = code[index];
    const next = code[index + 1];
    if (lineComment) {
      output += character;
      index += 1;
      if (character === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      output += character;
      index += 1;
      if (character === "*" && next === "/") {
        output += next;
        index += 1;
        blockComment = false;
      }
      continue;
    }
    if (quote !== undefined) {
      output += character;
      index += 1;
      if (character === "\\") {
        output += code[index] ?? "";
        index += 1;
      } else if (character === quote) {
        quote = undefined;
      }
      continue;
    }
    if (character === "/" && next === "/") {
      output += "//";
      index += 2;
      lineComment = true;
      continue;
    }
    if (character === "/" && next === "*") {
      output += "/*";
      index += 2;
      blockComment = true;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      output += character;
      index += 1;
      quote = character;
      continue;
    }
    const match = /^import\.meta\.(?:dirname|dir)\b/.exec(code.slice(index));
    if (match !== null) {
      output += directory;
      index += match[0].length;
      continue;
    }
    const pathMatch = /^import\.meta\.path\b/.exec(code.slice(index));
    if (pathMatch !== null) {
      output += filePath;
      index += pathMatch[0].length;
      continue;
    }
    output += character;
    index += 1;
  }
  return output;
}

export default {
  root: workspaceRoot,
  resolve: {
    alias:
      workspace === "packages/homelab/src/cdk8s"
        ? {
            "@shepherdjerred/homelab/cdk8s": workspaceRoot,
            "@shepherdjerred/monorepo/config": path.join(
              repositoryRoot,
              "config",
            ),
          }
        : {},
  },
  plugins: [
    {
      name: "bun-import-meta",
      transform(code, id) {
        if (
          !/import\.meta\.(?:dirname|dir|path)\b/u.test(code) ||
          id.startsWith("\0")
        ) {
          return;
        }
        const filename = id.split("?", 1)[0];
        if (filename === undefined) return;
        return replaceBunImportMetaDir(code, filename);
      },
    },
    {
      name: "raw-text",
      enforce: "pre",
      async load(id) {
        if (
          !id.endsWith(".txt") &&
          !id.includes("/asciinema-player/dist/bundle/asciinema-player.")
        ) {
          return;
        }
        return `export default ${JSON.stringify(await readFile(id, "utf8"))};`;
      },
    },
  ],
  test: {
    env: { TZ: "UTC" },
    ...(workspace === "packages/scout-for-lol/packages/design-system"
      ? { environment: "jsdom" }
      : {}),
    pool: "forks",
    exclude: [
      ...defaultTestExclude,
      ...(workspace === "packages/scout-for-lol"
        ? [
            path.join(
              workspaceRoot,
              "packages/backend/scripts/branded-types.test.ts",
            ),
          ]
        : workspace === "packages/scout-for-lol/packages/backend"
          ? [path.join(workspaceRoot, "scripts/branded-types.test.ts")]
          : []),
    ],
    setupFiles,
    ...(process.env["BIRMEL_VITEST_HARNESS"] === undefined
      ? {}
      : { include: [process.env["BIRMEL_VITEST_HARNESS"]] }),
    ...(workspace === "scripts"
      ? {
          include: [
            ...defaultTestInclude,
            "../.buildkite/scripts/**/*.{test,spec}.?(c|m)[jt]s?(x)",
          ],
        }
      : {}),
    ...(workspace === "packages/birmel"
      ? {
          fileParallelism: false,
          globalSetup: [
            path.join(
              workspaceRoot,
              "src/agent-tools/tools/automation/test-setup.ts",
            ),
          ],
        }
      : {}),
    ...(workspace === "packages/toolkit"
      ? { server: { deps: { inline: ["asciinema-player"] } } }
      : {}),
    deps: {
      // Vitest 4.1.x applies Node-style CJS interop to genuine ESM modules.
      // Bun exposes a present-but-undefined __esModule export, so the default
      // wrapper drops named exports such as Zod's `z`. Bun can load both ESM
      // and CJS directly; disable that Node-only wrapper until Vitest 5.
      interopDefault: false,
    },
    coverage: {
      provider: "istanbul",
      reporter: ["text", "lcovonly"],
      // These suites exercise source outside their project roots: docs-site
      // imports sibling Scout data, while root-scripts owns Buildkite scripts.
      allowExternal:
        workspace === "packages/scout-for-lol/packages/docs-site" ||
        workspace === "scripts",
      exclude: coverageExclusions,
      thresholds: coverageThresholds,
    },
  },
};
