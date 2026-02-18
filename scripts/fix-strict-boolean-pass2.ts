#!/usr/bin/env bun
/**
 * Second-pass codemod for strict-boolean-expressions.
 * Uses ESLint JSON output to find exact locations, then applies ts-morph fixes.
 * Also fixes no-unnecessary-condition from optional chains after null checks.
 */
import {
  Project,
  Node,
  SyntaxKind,
  type Type,
  type SourceFile,
} from "ts-morph";
import * as path from "node:path";
import { $ } from "bun";

const ROOT = path.resolve(import.meta.dir, "..");

type EslintMessage = {
  ruleId: string;
  line: number;
  column: number;
  message: string;
};

type EslintResult = {
  filePath: string;
  messages: EslintMessage[];
};

function isNullableString(type: Type): boolean {
  if (type.isUnion()) {
    const types = type.getUnionTypes();
    return (
      types.some((t) => t.isString() || t.isStringLiteral()) &&
      types.some((t) => t.isNull() || t.isUndefined())
    );
  }
  return false;
}

function isNullableBoolean(type: Type): boolean {
  if (type.isUnion()) {
    const types = type.getUnionTypes();
    return (
      types.some((t) => t.isBoolean() || t.isBooleanLiteral()) &&
      types.some((t) => t.isNull() || t.isUndefined())
    );
  }
  return false;
}

function isNullableNumber(type: Type): boolean {
  if (type.isUnion()) {
    const types = type.getUnionTypes();
    return (
      types.some((t) => t.isNumber() || t.isNumberLiteral()) &&
      types.some((t) => t.isNull() || t.isUndefined())
    );
  }
  return false;
}

function isNullable(type: Type): boolean {
  if (type.isUnion()) {
    return type.getUnionTypes().some((t) => t.isNull() || t.isUndefined());
  }
  return false;
}

function fixExpression(node: Node, negated: boolean): boolean {
  const type = node.getType();
  const text = node.getText();

  // Skip if already a comparison
  if (
    text.includes("!=") ||
    text.includes("==") ||
    text.includes("===") ||
    text.includes("!==") ||
    text.includes(" > ") ||
    text.includes(" < ")
  ) {
    return false;
  }

  if (isNullableString(type)) {
    if (negated) {
      node.replaceWithText(`(${text} == null || ${text}.length === 0)`);
    } else {
      node.replaceWithText(`(${text} != null && ${text}.length > 0)`);
    }
    return true;
  }

  if (isNullableBoolean(type)) {
    if (negated) {
      node.replaceWithText(`${text} !== true`);
    } else {
      node.replaceWithText(`${text} === true`);
    }
    return true;
  }

  if (isNullableNumber(type)) {
    if (negated) {
      node.replaceWithText(`${text} == null`);
    } else {
      node.replaceWithText(`${text} != null`);
    }
    return true;
  }

  if (isNullable(type)) {
    if (negated) {
      node.replaceWithText(`${text} == null`);
    } else {
      node.replaceWithText(`${text} != null`);
    }
    return true;
  }

  return false;
}

function findNodeAtPosition(
  sourceFile: SourceFile,
  line: number,
  col: number,
): Node | undefined {
  const pos = sourceFile.compilerNode.getPositionOfLineAndCharacter(
    line - 1,
    col - 1,
  );
  return sourceFile.getDescendantAtPos(pos);
}

function fixStrictBooleanAtLocation(
  sourceFile: SourceFile,
  line: number,
  col: number,
  message: string,
): boolean {
  const node = findNodeAtPosition(sourceFile, line, col);
  if (!node) return false;

  // Walk up to find the expression being used as a condition
  let expr = node;

  // If we're in a PrefixUnaryExpression (! operator), handle negation
  const parent = expr.getParent();
  if (
    parent &&
    Node.isPrefixUnaryExpression(parent) &&
    parent.getOperatorToken() === SyntaxKind.ExclamationToken
  ) {
    // The negated operand is the expression to fix
    return fixExpression(expr, true);
  }

  return fixExpression(expr, false);
}

function fixUnnecessaryOptionalChain(
  sourceFile: SourceFile,
  line: number,
  col: number,
): boolean {
  const node = findNodeAtPosition(sourceFile, line, col);
  if (!node) return false;

  // Find the parent optional chain expression
  let current: Node | undefined = node;
  while (
    current &&
    !Node.isPropertyAccessExpression(current) &&
    !Node.isElementAccessExpression(current) &&
    !Node.isCallExpression(current)
  ) {
    current = current.getParent();
  }

  if (!current) return false;

  const text = current.getText();
  // Replace ?. with .
  if (text.includes("?.")) {
    const newText = text.replace("?.", ".");
    current.replaceWithText(newText);
    return true;
  }

  return false;
}

async function processPackage(pkgPath: string): Promise<number> {
  console.log(`\nProcessing ${pkgPath}...`);

  // Get ESLint output
  const result =
    await $`cd ${path.join(ROOT, pkgPath)} && bunx eslint . --format json`
      .quiet()
      .nothrow();
  const eslintOutput = JSON.parse(result.stdout.toString()) as EslintResult[];

  // Collect issues by file
  const issuesByFile = new Map<string, EslintMessage[]>();
  for (const file of eslintOutput) {
    const relevant = file.messages.filter(
      (m) =>
        m.ruleId === "@typescript-eslint/strict-boolean-expressions" ||
        m.ruleId === "@typescript-eslint/no-unnecessary-condition",
    );
    if (relevant.length > 0) {
      issuesByFile.set(file.filePath, relevant);
    }
  }

  if (issuesByFile.size === 0) {
    console.log("  No issues to fix");
    return 0;
  }

  console.log(
    `  Found ${Array.from(issuesByFile.values()).reduce((sum, msgs) => sum + msgs.length, 0)} issues in ${issuesByFile.size} files`,
  );

  const tsconfigPath = path.join(ROOT, pkgPath, "tsconfig.json");
  const project = new Project({
    tsConfigFilePath: tsconfigPath,
    skipAddingFilesFromTsConfig: false,
  });

  let totalFixes = 0;

  for (const [filePath, messages] of issuesByFile) {
    const sourceFile = project.getSourceFile(filePath);
    if (!sourceFile) {
      console.log(`  Skipping ${filePath} (not in project)`);
      continue;
    }

    // Process in reverse order (bottom to top) to avoid position invalidation
    const sortedMessages = [...messages].sort(
      (a, b) => b.line - a.line || b.column - a.column,
    );

    let fileFixes = 0;
    for (const msg of sortedMessages) {
      let fixed = false;
      if (msg.ruleId === "@typescript-eslint/strict-boolean-expressions") {
        fixed = fixStrictBooleanAtLocation(
          sourceFile,
          msg.line,
          msg.column,
          msg.message,
        );
      } else if (msg.ruleId === "@typescript-eslint/no-unnecessary-condition") {
        fixed = fixUnnecessaryOptionalChain(sourceFile, msg.line, msg.column);
      }
      if (fixed) fileFixes++;
    }

    if (fileFixes > 0) {
      const relative = path.relative(ROOT, filePath);
      console.log(`  Fixed ${fileFixes}/${messages.length} in ${relative}`);
      totalFixes += fileFixes;
    }
  }

  await project.save();
  return totalFixes;
}

async function main() {
  const packages = [
    "packages/birmel",
    "packages/clauderon/web/frontend",
    "packages/clauderon/web/client",
  ];

  let total = 0;
  for (const pkg of packages) {
    total += await processPackage(pkg);
  }

  console.log(`\nTotal fixes: ${total}`);
}

main().catch(console.error);
