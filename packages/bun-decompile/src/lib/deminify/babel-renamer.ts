/**
 * Babel-based renamer for de-minification.
 *
 * Key principle: LLMs only suggest rename mappings, Babel does the actual renaming.
 * This guarantees functional equivalence - no LLM-introduced bugs.
 *
 * @see https://github.com/jehna/humanify - inspiration for this approach
 * @see https://gist.github.com/remorses/9a11d96f9f00d3af1388a197be2a7878 - BatchRenamer pattern
 */

import * as babel from "@babel/core";
import type { NodePath } from "@babel/traverse";
import _traverse from "@babel/traverse";
import _generate from "@babel/generator";
import * as t from "@babel/types";

// Handle ESM/CJS interop for Babel packages
const traverse =
  (_traverse as unknown as { default: typeof _traverse }).default ??
  _traverse;
const generate =
  (_generate as unknown as { default: typeof _generate }).default ??
  _generate;

/** Rename mapping for a single function */
export type FunctionRenameMapping = {
  /** New name for the function itself */
  functionName?: string;
  /** Description/comment for the function */
  description?: string;
  /** Identifier renames: old name -> new name */
  renames: Record<string, string>;
}

/** Rename mappings for multiple functions, keyed by function ID */
export type RenameMappings = Record<string, FunctionRenameMapping>

/** Options for the renamer */
export type RenamerOptions = {
  /** Whether to add description comments */
  addComments?: boolean;
  /** Whether to preserve existing comments */
  preserveComments?: boolean;
}

/**
 * Generate a unique function ID based on position in source.
 * This must match how we generate IDs when extracting functions.
 */
function getFunctionId(path: NodePath<t.Function>): string {
  const node = path.node;
  const start = node.start ?? 0;
  const end = node.end ?? 0;

  // Get the function name if available
  let name = "";
  if (t.isFunctionDeclaration(node) && node.id) {
    name = node.id.name;
  } else if (
    t.isFunctionExpression(node) ||
    t.isArrowFunctionExpression(node)
  ) {
    // Check if assigned to a variable
    const parent = path.parent;
    if (t.isVariableDeclarator(parent) && t.isIdentifier(parent.id)) {
      name = parent.id.name;
    } else if (
      t.isAssignmentExpression(parent) &&
      t.isIdentifier(parent.left)
    ) {
      name = parent.left.name;
    } else if (t.isObjectProperty(parent) && t.isIdentifier(parent.key)) {
      name = parent.key.name;
    }
  } else if ((t.isObjectMethod(node) || t.isClassMethod(node)) && t.isIdentifier(node.key)) {
      name = node.key.name;
    }

  return `${name}_${String(start)}_${String(end)}`;
}

/**
 * Handle renaming for a single function.
 */
function handleFunction(
  path: NodePath<t.Function>,
  mappings: RenameMappings,
  processedFunctions: Set<string>,
  addComments: boolean,
): void {
  const id = getFunctionId(path);
  const mapping = mappings[id];

  if (!mapping || processedFunctions.has(id)) {
    return;
  }
  processedFunctions.add(id);

  // Apply identifier renames within this function's scope
  for (const [oldName, newName] of Object.entries(mapping.renames)) {
    if (oldName === newName) {continue;}

    // Check if this binding exists in this scope
    const binding = path.scope.getBinding(oldName);
    if (binding) {
      // Use Babel's scope.rename() - handles all complexity
      path.scope.rename(oldName, newName);
    }
  }

  // Rename the function itself if needed
  if (mapping.functionName) {
    if (t.isFunctionDeclaration(path.node) && path.node.id) {
      const oldFuncName = path.node.id.name;
      if (oldFuncName !== mapping.functionName) {
        // Rename at the scope where the function is declared
        path.parentPath.scope.rename(oldFuncName, mapping.functionName);
      }
    } else if (t.isVariableDeclarator(path.parent) && // Arrow function or function expression assigned to variable
      t.isIdentifier(path.parent.id)) {
        const oldVarName = path.parent.id.name;
        if (oldVarName !== mapping.functionName) {
          path.parentPath.scope.rename(oldVarName, mapping.functionName);
        }
      }
  }

  // Add description comment if provided
  if (addComments && mapping.description) {
    const comment: t.Comment = {
      type: "CommentBlock",
      value: ` ${mapping.description} `,
    };

    // Find the statement to add comment to
    let targetPath: NodePath = path;
    if (t.isVariableDeclarator(path.parent)) {
      // For arrow functions, add comment to the variable declaration
      targetPath = path.parentPath.parentPath ?? path;
    }

    // Add leading comment
    const node = targetPath.node;
    node.leadingComments = node.leadingComments ?? [];
    node.leadingComments.push(comment);
  }
}

/**
 * Apply rename mappings to source code using Babel.
 *
 * This is the core function that guarantees functional equivalence:
 * - Uses Babel's scope.rename() which handles all scope complexity
 * - Respects scope boundaries and shadowing
 * - Updates all references consistently
 *
 * @param source - The source code to transform
 * @param mappings - Rename mappings from LLM
 * @param options - Optional configuration
 * @returns Transformed source code
 */
export function applyRenames(
  source: string,
  mappings: RenameMappings,
  options: RenamerOptions = {},
): string {
  const { addComments = true, preserveComments = true } = options;

  // Parse the source code
  const ast = babel.parseSync(source, {
    sourceType: "module",
    plugins: [
      "@babel/plugin-syntax-jsx",
      "@babel/plugin-syntax-typescript",
    ],
    // Preserve comments for output
    ...(preserveComments ? {} : { comments: false }),
  });

  if (!ast) {
    throw new Error("Failed to parse source code");
  }

  // Track which functions we've processed to avoid double-processing
  const processedFunctions = new Set<string>();

  // Traverse and apply renames
  traverse(ast, {
    FunctionDeclaration(path) {
      handleFunction(path, mappings, processedFunctions, addComments);
    },
    FunctionExpression(path) {
      handleFunction(path, mappings, processedFunctions, addComments);
    },
    ArrowFunctionExpression(path) {
      handleFunction(path, mappings, processedFunctions, addComments);
    },
    ObjectMethod(path) {
      handleFunction(path, mappings, processedFunctions, addComments);
    },
    ClassMethod(path) {
      handleFunction(path, mappings, processedFunctions, addComments);
    },
  });

  // Generate the transformed code
  const output = generate(ast, {
    retainLines: false,
    compact: false,
    comments: preserveComments,
  });

  return output.code;
}

/**
 * Apply renames to multiple files/chunks in a single operation.
 * More efficient than calling applyRenames() multiple times.
 */
export function applyRenamesBatch(
  sources: { id: string; source: string }[],
  allMappings: RenameMappings,
  options: RenamerOptions = {},
): Map<string, string> {
  const results = new Map<string, string>();

  for (const { id, source } of sources) {
    // Filter mappings to only those relevant to this source
    // For now, apply all mappings - Babel will ignore ones that don't apply
    try {
      const transformed = applyRenames(source, allMappings, options);
      results.set(id, transformed);
    } catch (error) {
      // On error, return original source
      console.error(`Error transforming ${id}:`, error);
      results.set(id, source);
    }
  }

  return results;
}

/**
 * Extract all identifiers from a function for LLM to rename.
 * This helps the LLM know what identifiers are available.
 */
export function extractIdentifiers(source: string): string[] {
  const identifiers = new Set<string>();

  try {
    const ast = babel.parseSync(source, {
      sourceType: "module",
      plugins: [
        "@babel/plugin-syntax-jsx",
        "@babel/plugin-syntax-typescript",
      ],
    });

    if (!ast) {return [];}

    traverse(ast, {
      Identifier(path) {
        // Only include identifiers that are bindings (not property access)
        if (path.isReferencedIdentifier()) {
          // Skip property access like obj.foo
          if (
            t.isMemberExpression(path.parent) &&
            path.parent.property === path.node
          ) {
            return;
          }
          // Skip object keys
          if (
            t.isObjectProperty(path.parent) &&
            path.parent.key === path.node &&
            !path.parent.computed
          ) {
            return;
          }
          identifiers.add(path.node.name);
        }
      },
    });
  } catch {
    // Parse error - return empty
  }

  return [...identifiers];
}
