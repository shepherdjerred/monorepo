/**
 * Zod schemas for narrowing Acorn AST nodes.
 *
 * Acorn's tree walker callbacks receive generic Node objects.
 * These schemas validate the specific properties we need and return
 * properly typed objects, replacing unsafe type assertions.
 *
 * Uses z.object().loose() so Node properties (start, end, type)
 * flow through without being stripped.
 */

import { z } from "zod";

// Base node fields present on all Acorn nodes
const baseNode = {
  type: z.string(),
  start: z.number(),
  end: z.number(),
};

// Lazy schemas for recursive node types
const lazyNode = z.lazy(() => z.object(baseNode).loose());

/** Identifier node: { type: "Identifier", name: "foo" } */
export const IdentifierSchema = z
  .object({
    ...baseNode,
    type: z.literal("Identifier"),
    name: z.string(),
  })
  .loose();
export type IdentifierNode = z.infer<typeof IdentifierSchema>;

/** Function node (declaration, expression, or arrow) */
export const FunctionNodeSchema = z
  .object({
    ...baseNode,
    type: z.enum([
      "FunctionDeclaration",
      "FunctionExpression",
      "ArrowFunctionExpression",
    ]),
    id: z.object({ name: z.string() }).nullable().optional(),
    params: z.array(lazyNode),
    body: lazyNode,
    async: z.boolean().optional(),
    generator: z.boolean().optional(),
  })
  .loose();
export type FunctionNode = z.infer<typeof FunctionNodeSchema>;

/** CallExpression node */
export const CallExpressionSchema = z
  .object({
    ...baseNode,
    type: z.literal("CallExpression"),
    callee: lazyNode,
    arguments: z.array(lazyNode),
  })
  .loose();
export type CallExpressionNode = z.infer<typeof CallExpressionSchema>;

/** MemberExpression node */
export const MemberExpressionSchema = z
  .object({
    ...baseNode,
    type: z.literal("MemberExpression"),
    object: lazyNode,
    property: lazyNode,
    computed: z.boolean(),
  })
  .loose();
export type MemberExpressionNode = z.infer<typeof MemberExpressionSchema>;

/** MethodDefinition node */
export const MethodDefinitionSchema = z
  .object({
    ...baseNode,
    type: z.literal("MethodDefinition"),
    key: lazyNode,
    value: lazyNode,
    kind: z.enum(["constructor", "method", "get", "set"]),
    static: z.boolean(),
  })
  .loose();
export type MethodDefinitionNode = z.infer<typeof MethodDefinitionSchema>;

/** VariableDeclarator node */
export const VariableDeclaratorSchema = z
  .object({
    ...baseNode,
    type: z.literal("VariableDeclarator"),
    id: z.object({ name: z.string().optional() }).loose().optional(),
  })
  .loose();
export type VariableDeclaratorNode = z.infer<typeof VariableDeclaratorSchema>;

/** AssignmentExpression node */
export const AssignmentExpressionSchema = z
  .object({
    ...baseNode,
    type: z.literal("AssignmentExpression"),
    left: lazyNode.optional(),
  })
  .loose();
export type AssignmentExpressionNode = z.infer<
  typeof AssignmentExpressionSchema
>;

/** Property node */
export const PropertySchema = z
  .object({
    ...baseNode,
    type: z.literal("Property"),
    key: lazyNode.optional(),
  })
  .loose();
export type PropertyNode = z.infer<typeof PropertySchema>;

/** Pattern node (RestElement, AssignmentPattern) */
export const PatternSchema = z
  .object({
    ...baseNode,
    left: lazyNode.optional(),
    argument: lazyNode.optional(),
    name: z.string().optional(),
  })
  .loose();
export type PatternNode = z.infer<typeof PatternSchema>;

/** ImportDeclaration node */
export const ImportDeclarationSchema = z
  .object({
    ...baseNode,
    type: z.literal("ImportDeclaration"),
    source: z.object({ value: z.string() }).loose(),
    specifiers: z.array(
      z
        .object({
          type: z.string(),
          local: z.object({ name: z.string() }),
          imported: z.object({ name: z.string() }).optional(),
        })
        .loose(),
    ),
  })
  .loose();
export type ImportDeclarationNode = z.infer<typeof ImportDeclarationSchema>;

/** ExportNamedDeclaration node */
export const ExportNamedDeclarationSchema = z
  .object({
    ...baseNode,
    type: z.literal("ExportNamedDeclaration"),
    declaration: z
      .object({
        id: z.object({ name: z.string() }).optional(),
        declarations: z
          .array(z.object({ id: z.object({ name: z.string() }) }).loose())
          .optional(),
      })
      .loose()
      .optional(),
    specifiers: z.array(
      z
        .object({
          local: z.object({ name: z.string() }),
          exported: z.object({ name: z.string() }),
        })
        .loose(),
    ),
  })
  .loose();
export type ExportNamedDeclarationNode = z.infer<
  typeof ExportNamedDeclarationSchema
>;

/** ExportDefaultDeclaration node */
export const ExportDefaultDeclarationSchema = z
  .object({
    ...baseNode,
    type: z.literal("ExportDefaultDeclaration"),
    declaration: z
      .object({
        id: z.object({ name: z.string() }).optional(),
        name: z.string().optional(),
      })
      .loose(),
  })
  .loose();
export type ExportDefaultDeclarationNode = z.infer<
  typeof ExportDefaultDeclarationSchema
>;

/**
 * Safe narrowing functions that use Zod safeParse.
 * Returns the parsed value or undefined if the node doesn't match.
 */

export function asFunctionNode(node: unknown): FunctionNode | undefined {
  const result = FunctionNodeSchema.safeParse(node);
  return result.success ? result.data : undefined;
}

export function asCallExpressionNode(
  node: unknown,
): CallExpressionNode | undefined {
  const result = CallExpressionSchema.safeParse(node);
  return result.success ? result.data : undefined;
}

export function asIdentifierNode(node: unknown): IdentifierNode | undefined {
  const result = IdentifierSchema.safeParse(node);
  return result.success ? result.data : undefined;
}

export function asMemberExpressionNode(
  node: unknown,
): MemberExpressionNode | undefined {
  const result = MemberExpressionSchema.safeParse(node);
  return result.success ? result.data : undefined;
}

export function asMethodDefinitionNode(
  node: unknown,
): MethodDefinitionNode | undefined {
  const result = MethodDefinitionSchema.safeParse(node);
  return result.success ? result.data : undefined;
}

export function asVariableDeclaratorNode(
  node: unknown,
): VariableDeclaratorNode | undefined {
  const result = VariableDeclaratorSchema.safeParse(node);
  return result.success ? result.data : undefined;
}

export function asAssignmentExpressionNode(
  node: unknown,
): AssignmentExpressionNode | undefined {
  const result = AssignmentExpressionSchema.safeParse(node);
  return result.success ? result.data : undefined;
}

export function asPropertyNode(node: unknown): PropertyNode | undefined {
  const result = PropertySchema.safeParse(node);
  return result.success ? result.data : undefined;
}

export function asImportDeclarationNode(
  node: unknown,
): ImportDeclarationNode | undefined {
  const result = ImportDeclarationSchema.safeParse(node);
  return result.success ? result.data : undefined;
}

export function asExportNamedDeclarationNode(
  node: unknown,
): ExportNamedDeclarationNode | undefined {
  const result = ExportNamedDeclarationSchema.safeParse(node);
  return result.success ? result.data : undefined;
}

export function asExportDefaultDeclarationNode(
  node: unknown,
): ExportDefaultDeclarationNode | undefined {
  const result = ExportDefaultDeclarationSchema.safeParse(node);
  return result.success ? result.data : undefined;
}
