import * as acorn from "acorn";
import * as walk from "acorn-walk";
import type { Node } from "acorn";
import type {
  ExtractedFunction,
  FunctionType,
  ParameterInfo,
} from "./types.ts";
import {
  PatternSchema,
  asFunctionNode,
  asMethodDefinitionNode,
  asCallExpressionNode,
  asIdentifierNode,
  asMemberExpressionNode,
  asVariableDeclaratorNode,
  asAssignmentExpressionNode,
  asPropertyNode,
  type FunctionNode,
  type AssignmentExpressionNode,
  type MethodDefinitionNode,
} from "./ast-node-schemas.ts";

/** Options for extractFunction */
type ExtractFunctionOpts = {
  node: FunctionNode;
  originalNode: Node;
  source: string;
  index: number;
  type: FunctionType;
  ancestors: Node[];
  nodeToFunction: Map<Node, ExtractedFunction>;
  overrideName?: string;
};

/** Parse JavaScript source and extract all functions */
export function parseAndExtractFunctions(
  source: string,
  options?: { sourceType?: "module" | "script" },
): ExtractedFunction[] {
  const ast = acorn.parse(source, {
    ecmaVersion: "latest",
    sourceType: options?.sourceType ?? "module",
    locations: true,
  });

  const functions: ExtractedFunction[] = [];
  const nodeToFunction = new Map<Node, ExtractedFunction>();
  let functionIndex = 0;

  // First pass: extract all functions
  walk.ancestor(ast, {
    FunctionDeclaration(node: Node, _state: unknown, ancestors: Node[]) {
      const fn = asFunctionNode(node);
      if (!fn) {
        return;
      }
      const func = extractFunction({
        node: fn,
        originalNode: node,
        source,
        index: functionIndex++,
        type: "function-declaration",
        ancestors,
        nodeToFunction,
      });
      functions.push(func);
      nodeToFunction.set(node, func);
    },
    FunctionExpression(node: Node, _state: unknown, ancestors: Node[]) {
      const fn = asFunctionNode(node);
      if (!fn) {
        return;
      }
      const func = extractFunction({
        node: fn,
        originalNode: node,
        source,
        index: functionIndex++,
        type: "function-expression",
        ancestors,
        nodeToFunction,
      });
      functions.push(func);
      nodeToFunction.set(node, func);
    },
    ArrowFunctionExpression(node: Node, _state: unknown, ancestors: Node[]) {
      const fn = asFunctionNode(node);
      if (!fn) {
        return;
      }
      const func = extractFunction({
        node: fn,
        originalNode: node,
        source,
        index: functionIndex++,
        type: "arrow-function",
        ancestors,
        nodeToFunction,
      });
      functions.push(func);
      nodeToFunction.set(node, func);
    },
    MethodDefinition(node: Node, _state: unknown, ancestors: Node[]) {
      const methodDef = asMethodDefinitionNode(node);
      if (!methodDef) {
        return;
      }
      const valueFn = asFunctionNode(methodDef.value);
      if (!valueFn) {
        return;
      }
      const type = getMethodType(methodDef.kind);
      const func = extractFunction({
        node: valueFn,
        originalNode: node,
        source,
        index: functionIndex++,
        type,
        ancestors,
        nodeToFunction,
        overrideName: getMethodName(methodDef),
      });
      // Use the full method definition range including the key
      func.start = node.start;
      func.end = node.end;
      func.source = source.slice(func.start, func.end);
      functions.push(func);
      nodeToFunction.set(node, func);
    },
  });

  // Second pass: extract callees for each function
  for (const func of functions) {
    func.callees = extractCallees(func.node, source);
  }

  // Establish parent-child relationships
  establishParentChildRelationships(functions);

  return functions;
}

/** Establish parent-child relationships between nested functions */
function establishParentChildRelationships(
  functions: ExtractedFunction[],
): void {
  for (const func of functions) {
    for (const otherFunc of functions) {
      if (func === otherFunc) {
        continue;
      }
      if (otherFunc.start <= func.start || otherFunc.end >= func.end) {
        continue;
      }

      // otherFunc is nested inside func
      const existingParent =
        otherFunc.parentId != null && otherFunc.parentId.length > 0
          ? functions.find((f) => f.id === otherFunc.parentId)
          : undefined;
      if (
        otherFunc.parentId == null ||
        otherFunc.parentId.length === 0 ||
        (existingParent != null && func.start > existingParent.start)
      ) {
        // func is a closer parent (more deeply nested)
        removeFromOldParent(otherFunc, functions);
        otherFunc.parentId = func.id;
        func.children.push(otherFunc.id);
      }
    }
  }
}

/** Remove otherFunc from its old parent's children list */
function removeFromOldParent(
  otherFunc: ExtractedFunction,
  functions: ExtractedFunction[],
): void {
  if (otherFunc.parentId == null || otherFunc.parentId.length === 0) {
    return;
  }
  const oldParent = functions.find((f) => f.id === otherFunc.parentId);
  if (oldParent) {
    oldParent.children = oldParent.children.filter((c) => c !== otherFunc.id);
  }
}

/** Extract a single function from an AST node */
function extractFunction(opts: ExtractFunctionOpts): ExtractedFunction {
  const {
    node,
    originalNode,
    source,
    index,
    type,
    ancestors,
    nodeToFunction,
    overrideName,
  } = opts;
  const name = overrideName ?? getFunctionName(node, ancestors);
  const id = generateFunctionId(node, source, index, name);

  // Find parent function
  let parentId: string | null = null;
  for (let i = ancestors.length - 2; i >= 0; i--) {
    const ancestor = ancestors[i];
    if (!ancestor) {
      continue;
    }
    const parentFunc = nodeToFunction.get(ancestor);
    if (parentFunc) {
      parentId = parentFunc.id;
      break;
    }
  }

  return {
    id,
    originalName: name,
    type,
    start: node.start,
    end: node.end,
    source: source.slice(node.start, node.end),
    callees: [],
    callers: [],
    params: extractParameters(node),
    isAsync: node.async ?? false,
    isGenerator: node.generator ?? false,
    parentId,
    children: [],
    node: originalNode,
  };
}

/** Get function name from node or infer from context */
function getFunctionName(node: FunctionNode, ancestors: Node[]): string {
  if (node.id?.name != null && node.id.name.length > 0) {
    return node.id.name;
  }

  const parent = ancestors.at(-2);
  if (parent != null) {
    const varDecl = asVariableDeclaratorNode(parent);
    if (varDecl?.id?.name != null && varDecl.id.name.length > 0) {
      return varDecl.id.name;
    }
  }

  if (parent != null) {
    const assign = asAssignmentExpressionNode(parent);
    if (assign) {
      return getNameFromAssignment(assign);
    }
  }

  if (parent != null) {
    const prop = asPropertyNode(parent);
    if (prop?.key != null) {
      const keyIdent = asIdentifierNode(prop.key);
      if (keyIdent) {
        return keyIdent.name;
      }
    }
  }

  return "";
}

/** Extract name from an assignment expression's left-hand side */
function getNameFromAssignment(assign: AssignmentExpressionNode): string {
  if (assign.left != null) {
    const member = asMemberExpressionNode(assign.left);
    if (member) {
      const propIdent = asIdentifierNode(member.property);
      if (propIdent) {
        return propIdent.name;
      }
    }
    const ident = asIdentifierNode(assign.left);
    if (ident) {
      return ident.name;
    }
  }
  return "";
}

/** Get method type from MethodDefinition kind */
function getMethodType(kind: string): FunctionType {
  switch (kind) {
    case "constructor": {
      return "constructor";
    }
    case "get": {
      return "getter";
    }
    case "set": {
      return "setter";
    }
    default: {
      return "method";
    }
  }
}

/** Get method name from MethodDefinition node */
function getMethodName(node: MethodDefinitionNode): string {
  const ident = asIdentifierNode(node.key);
  return ident?.name ?? "";
}

/** Generate a unique ID for a function */
function generateFunctionId(
  node: FunctionNode,
  _source: string,
  _index: number,
  name = "anon",
): string {
  const prefix = name || "anon";
  return `${prefix}_${String(node.start)}_${String(node.end)}`;
}

/** Extract parameter information from a function node */
function extractParameters(node: FunctionNode): ParameterInfo[] {
  return node.params.map((param) => extractParameterInfo(param));
}

/** Extract info from a single parameter node */
function extractParameterInfo(param: unknown): ParameterInfo {
  const identParam = asIdentifierNode(param);
  if (identParam) {
    return { name: identParam.name, hasDefault: false, isRest: false };
  }

  const parsed = PatternSchema.safeParse(param);
  if (!parsed.success) {
    return { name: "", hasDefault: false, isRest: false };
  }
  const pattern = parsed.data;

  if (pattern.type === "RestElement") {
    const argIdent = pattern.argument
      ? asIdentifierNode(pattern.argument)
      : undefined;
    return { name: argIdent?.name ?? "", hasDefault: false, isRest: true };
  }

  if (pattern.type === "AssignmentPattern") {
    const leftIdent = pattern.left ? asIdentifierNode(pattern.left) : undefined;
    return { name: leftIdent?.name ?? "", hasDefault: true, isRest: false };
  }

  return { name: "", hasDefault: false, isRest: false };
}

/** Extract all function callees from a node */
export function extractCallees(node: Node, _source: string): string[] {
  const callees = new Set<string>();

  walk.simple(node, {
    CallExpression(callNode: Node) {
      const call = asCallExpressionNode(callNode);
      if (!call) {
        return;
      }
      const name = getCalleeName(call.callee);
      if (name != null && name.length > 0) {
        callees.add(name);
      }
    },
  });

  return [...callees];
}

/** Get the name of a callee from a CallExpression */
function getCalleeName(callee: unknown): string | null {
  const ident = asIdentifierNode(callee);
  if (ident) {
    return ident.name;
  }

  const member = asMemberExpressionNode(callee);
  if (member && !member.computed) {
    const propIdent = asIdentifierNode(member.property);
    if (propIdent) {
      return propIdent.name;
    }
  }

  return null;
}

/** Parse source and return AST (for validation) */
export function parseSource(
  source: string,
  options?: { sourceType?: "module" | "script" },
): Node {
  return acorn.parse(source, {
    ecmaVersion: "latest",
    sourceType: options?.sourceType ?? "module",
    locations: true,
  });
}

/** Validate that source code parses successfully */
export function validateSource(source: string): boolean {
  try {
    acorn.parse(source, { ecmaVersion: "latest", sourceType: "module" });
    return true;
  } catch {
    try {
      acorn.parse(source, { ecmaVersion: "latest", sourceType: "script" });
      return true;
    } catch {
      return false;
    }
  }
}
