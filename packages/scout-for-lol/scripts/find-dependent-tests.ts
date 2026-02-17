#!/usr/bin/env bun
/**
 * Finds all test files that should run based on changed source files.
 * Uses TypeScript's Compiler API for accurate dependency resolution.
 */

import ts from "typescript";

const args = Bun.argv.slice(2);
if (args.length < 2) {
  console.error(
    "Usage: find-dependent-tests.ts <package-dir> <changed-files...>",
  );
  throw new Error("Missing required arguments");
}

// Args are guaranteed to exist after length check
// eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- CLI args validated above
const packageDir = args[0]!;
const changedFiles = args.slice(1);

// Convert to absolute paths
const repoRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const absolutePackageDir = `${repoRoot}/${packageDir}`;

// Find tsconfig.json
const tsconfigPath = `${absolutePackageDir}/tsconfig.json`;
if (!(await Bun.file(tsconfigPath).exists())) {
  console.error(`No tsconfig.json found at ${tsconfigPath}`);
  process.exit(1);
}

// Load TypeScript config
const readFile = (path: string): string | undefined => ts.sys.readFile(path);
const configFile = ts.readConfigFile(tsconfigPath, readFile);
if (configFile.error) {
  // TypeScript's DiagnosticMessageChain is a special type that can be a string or an object
  const messageText = configFile.error.messageText;

  const errorMessage =
    typeof messageText === "string" ? messageText : messageText.messageText;
  console.error(`Error reading tsconfig.json: ${errorMessage}`);
  process.exit(1);
}

const parsedConfig = ts.parseJsonConfigFileContent(
  configFile.config,
  ts.sys,
  absolutePackageDir,
);

// Create TypeScript program
console.error("Loading TypeScript program...");
const program = ts.createProgram({
  rootNames: parsedConfig.fileNames,
  options: parsedConfig.options,
});

// Normalize changed files to absolute paths
const absoluteChangedFiles = changedFiles
  .filter((f) => f.startsWith(packageDir))
  .map((f) => `${repoRoot}/${f}`);

if (absoluteChangedFiles.length === 0) {
  console.error("No relevant files changed in this package.");
  process.exit(0);
}

console.error(
  `Analyzing ${String(absoluteChangedFiles.length)} changed file(s)...`,
);

// Build reverse dependency map: file -> files that depend on it
const reverseDeps = new Map<string, Set<string>>();

// Get all source files in the program
const sourceFiles = program.getSourceFiles().filter((sf) => {
  const filePath = sf.fileName;
  // Only include files in our package, exclude node_modules and generated files
  return (
    filePath.startsWith(absolutePackageDir) &&
    !filePath.includes("node_modules") &&
    !filePath.includes("/generated/") &&
    !filePath.includes("/dist/") &&
    !filePath.includes("/build/")
  );
});

console.error(
  `Building dependency graph for ${String(sourceFiles.length)} files...`,
);

// Build dependency graph using TypeScript's module resolution
for (const sourceFile of sourceFiles) {
  const filePath = sourceFile.fileName;

  // Get all import declarations
  const imports = new Set<string>();

  function addResolvedImport(moduleSpecifier: ts.Expression | undefined) {
    if (moduleSpecifier && ts.isStringLiteral(moduleSpecifier)) {
      const resolved = resolveImport(filePath, moduleSpecifier.text);
      if (resolved !== null) {
        imports.add(resolved);
      }
    }
  }

  function visit(node: ts.Node) {
    // Handle import declarations
    if (ts.isImportDeclaration(node)) {
      addResolvedImport(node.moduleSpecifier);
    }

    // Handle export declarations
    if (ts.isExportDeclaration(node)) {
      addResolvedImport(node.moduleSpecifier);
    }

    // Handle dynamic imports: import('...')
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const arg = node.arguments[0];
        if (arg && ts.isStringLiteral(arg)) {
          const resolved = resolveImport(filePath, arg.text);
          if (resolved !== null) {
            imports.add(resolved);
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  // Add to reverse dependency map
  for (const importedFile of imports) {
    if (!reverseDeps.has(importedFile)) {
      reverseDeps.set(importedFile, new Set());
    }
    const deps = reverseDeps.get(importedFile);
    if (deps) {
      deps.add(filePath);
    }
  }
}

// Helper to resolve imports using TypeScript's module resolution
function resolveImport(fromFile: string, moduleName: string): string | null {
  const resolved = ts.resolveModuleName(
    moduleName,
    fromFile,
    parsedConfig.options,
    ts.sys,
  );

  if (resolved.resolvedModule) {
    const resolvedPath = resolved.resolvedModule.resolvedFileName;
    // Only include files from our package
    if (resolvedPath.startsWith(absolutePackageDir)) {
      return resolvedPath;
    }
  }

  return null;
}

// Find all affected files (transitive dependencies)
const affectedFiles = new Set<string>(absoluteChangedFiles);

function findDependents(file: string, visited = new Set<string>()) {
  if (visited.has(file)) {
    return;
  }
  visited.add(file);

  const dependents = reverseDeps.get(file);
  if (dependents) {
    for (const dependent of dependents) {
      affectedFiles.add(dependent);
      findDependents(dependent, visited);
    }
  }
}

// Find all files that transitively depend on changed files
for (const file of absoluteChangedFiles) {
  findDependents(file);
}

console.error(
  `Total affected files (including transitive deps): ${String(affectedFiles.size)}`,
);

// Find test files for affected files
const testFiles = new Set<string>();

for (const file of affectedFiles) {
  // If it's already a test file, add it
  if (file.endsWith(".test.ts") || file.endsWith(".integration.test.ts")) {
    testFiles.add(file);
    continue;
  }

  // Find corresponding test files
  const base = file.replace(/\.tsx?$/, "");
  const unitTest = `${base}.test.ts`;
  const integrationTest = `${base}.integration.test.ts`;

  if (await Bun.file(unitTest).exists()) {
    testFiles.add(unitTest);
  }

  if (await Bun.file(integrationTest).exists()) {
    testFiles.add(integrationTest);
  }
}

if (testFiles.size === 0) {
  console.error("No relevant test files found.");
  process.exit(0);
}

console.error(`Found ${String(testFiles.size)} relevant test file(s)`);

// Output test files (one per line) to stdout
for (const testFile of testFiles) {
  console.log(testFile);
}
