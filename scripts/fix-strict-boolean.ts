#!/usr/bin/env bun
/**
 * Codemod to fix @typescript-eslint/strict-boolean-expressions warnings.
 * Uses ts-morph to properly type-check and transform conditionals.
 */
import { Project, Node, SyntaxKind, type Type, type SourceFile } from "ts-morph";
import * as path from "node:path";

const PACKAGES = [
  "packages/tools",
  "packages/birmel",
  "packages/clauderon/web/frontend",
];

const ROOT = path.resolve(import.meta.dir, "..");

function isNullableString(type: Type): boolean {
  if (type.isUnion()) {
    const types = type.getUnionTypes();
    const hasString = types.some(t => t.isString() || t.isStringLiteral());
    const hasNullOrUndefined = types.some(t => t.isNull() || t.isUndefined());
    return hasString && hasNullOrUndefined;
  }
  return false;
}

function isNullableBoolean(type: Type): boolean {
  if (type.isUnion()) {
    const types = type.getUnionTypes();
    const hasBool = types.some(t => t.isBoolean() || t.isBooleanLiteral());
    const hasNullOrUndefined = types.some(t => t.isNull() || t.isUndefined());
    return hasBool && hasNullOrUndefined;
  }
  return false;
}

function isNullableNumber(type: Type): boolean {
  if (type.isUnion()) {
    const types = type.getUnionTypes();
    const hasNum = types.some(t => t.isNumber() || t.isNumberLiteral());
    const hasNullOrUndefined = types.some(t => t.isNull() || t.isUndefined());
    return hasNum && hasNullOrUndefined;
  }
  return false;
}

function isNullableEnum(type: Type): boolean {
  if (type.isUnion()) {
    const types = type.getUnionTypes();
    const hasEnum = types.some(t => t.isEnum() || t.isEnumLiteral());
    const hasNullOrUndefined = types.some(t => t.isNull() || t.isUndefined());
    return hasEnum && hasNullOrUndefined;
  }
  return false;
}

function isNullableObject(type: Type): boolean {
  if (type.isUnion()) {
    const types = type.getUnionTypes();
    const hasObj = types.some(t => t.isObject() || t.isArray() || t.isInterface());
    const hasNullOrUndefined = types.some(t => t.isNull() || t.isUndefined());
    return hasObj && hasNullOrUndefined;
  }
  return false;
}

function isNullable(type: Type): boolean {
  if (type.isUnion()) {
    return type.getUnionTypes().some(t => t.isNull() || t.isUndefined());
  }
  return false;
}

function hasOnlyUndefined(type: Type): boolean {
  if (type.isUnion()) {
    const types = type.getUnionTypes();
    return types.some(t => t.isUndefined()) && !types.some(t => t.isNull());
  }
  return false;
}

function hasOnlyNull(type: Type): boolean {
  if (type.isUnion()) {
    const types = type.getUnionTypes();
    return types.some(t => t.isNull()) && !types.some(t => t.isUndefined());
  }
  return false;
}

/**
 * Get the appropriate null check for a type.
 */
function getNullCheck(type: Type, exprText: string, negated: boolean): string | null {
  if (isNullableString(type)) {
    // For strings: falsy means null/undefined/empty
    // if (str) -> if (str != null && str.length > 0)
    // if (!str) -> if (str == null || str.length === 0)
    if (negated) {
      return `${exprText} == null || ${exprText}.length === 0`;
    }
    return `${exprText} != null && ${exprText}.length > 0`;
  }

  if (isNullableBoolean(type)) {
    // For booleans: check for truthiness explicitly
    // if (bool) -> if (bool === true)
    // if (!bool) -> if (bool !== true)
    if (negated) {
      return `${exprText} !== true`;
    }
    return `${exprText} === true`;
  }

  if (isNullableNumber(type)) {
    // For numbers: falsy means null/undefined/0/NaN
    // if (num) -> if (num != null)  (most common intent)
    // if (!num) -> if (num == null)
    if (negated) {
      return `${exprText} == null`;
    }
    return `${exprText} != null`;
  }

  if (isNullableEnum(type) || isNullableObject(type)) {
    if (negated) {
      return `${exprText} == null`;
    }
    return `${exprText} != null`;
  }

  if (isNullable(type)) {
    // Generic nullable
    if (negated) {
      return `${exprText} == null`;
    }
    return `${exprText} != null`;
  }

  return null;
}

function processCondition(node: Node, sourceFile: SourceFile): number {
  let fixes = 0;

  // Handle PrefixUnaryExpression (negation: !expr)
  if (Node.isPrefixUnaryExpression(node) && node.getOperatorToken() === SyntaxKind.ExclamationToken) {
    const operand = node.getOperand();
    const type = operand.getType();
    const exprText = operand.getText();

    const replacement = getNullCheck(type, exprText, true);
    if (replacement !== null) {
      node.replaceWithText(replacement);
      fixes++;
      return fixes;
    }
  }

  // Handle direct expression in condition
  if (!Node.isBinaryExpression(node) && !Node.isPrefixUnaryExpression(node)) {
    const type = node.getType();
    const exprText = node.getText();

    // Skip if it's already a comparison
    if (exprText.includes("!=") || exprText.includes("==") || exprText.includes("===") || exprText.includes("!==")) {
      return fixes;
    }

    const replacement = getNullCheck(type, exprText, false);
    if (replacement !== null) {
      node.replaceWithText(replacement);
      fixes++;
    }
  }

  return fixes;
}

function processFile(sourceFile: SourceFile): number {
  let totalFixes = 0;

  // Process if statements
  const ifStatements = sourceFile.getDescendantsOfKind(SyntaxKind.IfStatement);
  for (const ifStmt of ifStatements) {
    const condition = ifStmt.getExpression();
    totalFixes += processCondition(condition, sourceFile);
  }

  // Process ternary/conditional expressions
  const conditionalExprs = sourceFile.getDescendantsOfKind(SyntaxKind.ConditionalExpression);
  for (const condExpr of conditionalExprs) {
    const condition = condExpr.getCondition();
    totalFixes += processCondition(condition, sourceFile);
  }

  // Process while statements
  const whileStatements = sourceFile.getDescendantsOfKind(SyntaxKind.WhileStatement);
  for (const whileStmt of whileStatements) {
    const condition = whileStmt.getExpression();
    totalFixes += processCondition(condition, sourceFile);
  }

  // Process for statements (condition part)
  // These are rare so skip for now

  // Process logical AND (&&) expressions used as conditions
  // e.g., expr && something -> expr != null && something
  const binaryExprs = sourceFile.getDescendantsOfKind(SyntaxKind.BinaryExpression);
  for (const binExpr of binaryExprs) {
    const op = binExpr.getOperatorToken().getKind();
    if (op === SyntaxKind.AmpersandAmpersandToken || op === SyntaxKind.BarBarToken) {
      const left = binExpr.getLeft();
      const right = binExpr.getRight();

      // Check left side
      if (!Node.isBinaryExpression(left) && !Node.isPrefixUnaryExpression(left)) {
        const leftType = left.getType();
        const leftText = left.getText();
        if (!leftText.includes("!=") && !leftText.includes("==") && !leftText.includes("===") && !leftText.includes("!==")) {
          const isNegatedContext = op === SyntaxKind.BarBarToken;
          // For ||: left side is tested as falsy (negated=false since we want truthiness check that was failing)
          // For &&: left side is tested as truthy
          const replacement = getNullCheck(leftType, leftText, false);
          if (replacement !== null) {
            left.replaceWithText(replacement);
            totalFixes++;
          }
        }
      }

      // Re-fetch right since tree may have changed
      try {
        const newRight = binExpr.getRight();
        if (!Node.isBinaryExpression(newRight) && !Node.isPrefixUnaryExpression(newRight)) {
          const rightType = newRight.getType();
          const rightText = newRight.getText();
          if (!rightText.includes("!=") && !rightText.includes("==") && !rightText.includes("===") && !rightText.includes("!==")) {
            const replacement = getNullCheck(rightType, rightText, false);
            if (replacement !== null) {
              newRight.replaceWithText(replacement);
              totalFixes++;
            }
          }
        }
      } catch {
        // Tree may have been invalidated
      }
    }
  }

  return totalFixes;
}

async function main() {
  let totalFixes = 0;

  for (const pkg of PACKAGES) {
    const pkgPath = path.join(ROOT, pkg);
    const tsconfigPath = path.join(pkgPath, "tsconfig.json");

    console.log(`\nProcessing ${pkg}...`);

    const project = new Project({
      tsConfigFilePath: tsconfigPath,
      skipAddingFilesFromTsConfig: false,
    });

    const sourceFiles = project.getSourceFiles();
    console.log(`  Found ${sourceFiles.length} source files`);

    for (const sourceFile of sourceFiles) {
      const relativePath = path.relative(ROOT, sourceFile.getFilePath());

      // Skip node_modules and generated files
      if (relativePath.includes("node_modules") || relativePath.includes("generated")) {
        continue;
      }

      const fixes = processFile(sourceFile);
      if (fixes > 0) {
        console.log(`  Fixed ${fixes} issues in ${relativePath}`);
        totalFixes += fixes;
      }
    }

    await project.save();
    console.log(`  Saved changes for ${pkg}`);
  }

  console.log(`\nTotal fixes: ${totalFixes}`);
}

main().catch(console.error);
