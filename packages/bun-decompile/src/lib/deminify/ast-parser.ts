import * as acorn from "acorn";
import * as walk from "acorn-walk";
import type { Node } from "acorn";
import type { ExtractedFunction, FunctionType, ParameterInfo } from "./types.ts";

/** Extended node types for Acorn AST */
type FunctionNode = {
  id?: { name: string } | null;
  params: Node[];
  body: Node;
  async?: boolean;
  generator?: boolean;
} & Node

type CallExpressionNode = {
  callee: Node;
  arguments: Node[];
} & Node

type IdentifierNode = {
  name: string;
} & Node

type MemberExpressionNode = {
  object: Node;
  property: Node;
  computed: boolean;
} & Node

type MethodDefinitionNode = {
  key: Node;
  value: Node;
  kind: "constructor" | "method" | "get" | "set";
  static: boolean;
} & Node

type PatternNode = {
  left?: Node;
  argument?: Node;
  name?: string;
} & Node

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
      const func = extractFunction(
        node as FunctionNode,
        source,
        functionIndex++,
        "function-declaration",
        ancestors,
        nodeToFunction,
      );
      functions.push(func);
      nodeToFunction.set(node, func);
    },
    FunctionExpression(node: Node, _state: unknown, ancestors: Node[]) {
      const func = extractFunction(
        node as FunctionNode,
        source,
        functionIndex++,
        "function-expression",
        ancestors,
        nodeToFunction,
      );
      functions.push(func);
      nodeToFunction.set(node, func);
    },
    ArrowFunctionExpression(node: Node, _state: unknown, ancestors: Node[]) {
      const func = extractFunction(
        node as FunctionNode,
        source,
        functionIndex++,
        "arrow-function",
        ancestors,
        nodeToFunction,
      );
      functions.push(func);
      nodeToFunction.set(node, func);
    },
    MethodDefinition(node: Node, _state: unknown, ancestors: Node[]) {
      const methodNode = node as MethodDefinitionNode;
      const valueNode = methodNode.value as FunctionNode;
      const type = getMethodType(methodNode.kind);
      const func = extractFunction(
        valueNode,
        source,
        functionIndex++,
        type,
        ancestors,
        nodeToFunction,
        getMethodName(methodNode),
      );
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
  for (const func of functions) {
    for (const otherFunc of functions) {
      if (func === otherFunc) continue;
      if (otherFunc.start > func.start && otherFunc.end < func.end) {
        // otherFunc is nested inside func
        const existingParent = otherFunc.parentId
          ? functions.find((f) => f.id === otherFunc.parentId)
          : undefined;
        if (
          !otherFunc.parentId ||
          (existingParent && func.start > existingParent.start)
        ) {
          // func is a closer parent (more deeply nested)
          if (otherFunc.parentId) {
            const oldParent = functions.find((f) => f.id === otherFunc.parentId);
            if (oldParent) {
              oldParent.children = oldParent.children.filter((c) => c !== otherFunc.id);
            }
          }
          otherFunc.parentId = func.id;
          func.children.push(otherFunc.id);
        }
      }
    }
  }

  return functions;
}

/** Extract a single function from an AST node */
function extractFunction(
  node: FunctionNode,
  source: string,
  index: number,
  type: FunctionType,
  ancestors: Node[],
  nodeToFunction: Map<Node, ExtractedFunction>,
  overrideName?: string,
): ExtractedFunction {
  const name = overrideName ?? getFunctionName(node, ancestors);
  const id = generateFunctionId(node, source, index, name);

  // Find parent function
  let parentId: string | null = null;
  for (let i = ancestors.length - 2; i >= 0; i--) {
    const ancestor = ancestors[i];
    if (!ancestor) continue;
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
    callees: [], // Populated in second pass
    callers: [], // Populated by call graph builder
    params: extractParameters(node),
    isAsync: node.async ?? false,
    isGenerator: node.generator ?? false,
    parentId,
    children: [],
    node,
  };
}

/** Get function name from node or infer from context */
function getFunctionName(node: FunctionNode, ancestors: Node[]): string {
  // Named function
  if (node.id?.name) {
    return node.id.name;
  }

  // Check if assigned to a variable: const foo = function() {}
  const parent = ancestors[ancestors.length - 2];
  if (parent?.type === "VariableDeclarator") {
    const varDecl = parent as Node & { id?: { name?: string } };
    if (varDecl.id?.name) {
      return varDecl.id.name;
    }
  }

  // Check if property assignment: obj.foo = function() {}
  if (parent?.type === "AssignmentExpression") {
    const assign = parent as Node & { left?: MemberExpressionNode | IdentifierNode };
    if (assign.left?.type === "MemberExpression") {
      const prop = (assign.left as MemberExpressionNode).property;
      if (prop.type === "Identifier") {
        return (prop as IdentifierNode).name;
      }
    }
    if (assign.left?.type === "Identifier") {
      return (assign.left as IdentifierNode).name;
    }
  }

  // Check if object property: { foo: function() {} }
  if (parent?.type === "Property") {
    const prop = parent as Node & { key?: IdentifierNode | Node };
    if (prop.key?.type === "Identifier") {
      return (prop.key as IdentifierNode).name;
    }
  }

  return "";
}

/** Get method type from MethodDefinition kind */
function getMethodType(kind: string): FunctionType {
  switch (kind) {
    case "constructor":
      return "constructor";
    case "get":
      return "getter";
    case "set":
      return "setter";
    default:
      return "method";
  }
}

/** Get method name from MethodDefinition node */
function getMethodName(node: MethodDefinitionNode): string {
  if (node.key.type === "Identifier") {
    return (node.key as IdentifierNode).name;
  }
  return "";
}

/** Generate a unique ID for a function */
function generateFunctionId(
  node: FunctionNode,
  _source: string,
  _index: number,
  name: string,
): string {
  const prefix = name || "anon";
  // Use start_end format to match babel-renamer.ts
  return `${prefix}_${String(node.start)}_${String(node.end)}`;
}

/** Extract parameter information from a function node */
function extractParameters(node: FunctionNode): ParameterInfo[] {
  return node.params.map((param) => extractParameterInfo(param as PatternNode));
}

/** Extract info from a single parameter node */
function extractParameterInfo(param: PatternNode): ParameterInfo {
  // Simple identifier: function(x)
  if (param.type === "Identifier") {
    return {
      name: param.name ?? "",
      hasDefault: false,
      isRest: false,
    };
  }

  // Rest parameter: function(...args)
  if (param.type === "RestElement") {
    const arg = param.argument as PatternNode | undefined;
    return {
      name: arg?.name ?? "",
      hasDefault: false,
      isRest: true,
    };
  }

  // Default parameter: function(x = 1)
  if (param.type === "AssignmentPattern") {
    const left = param.left as PatternNode | undefined;
    return {
      name: left?.name ?? "",
      hasDefault: true,
      isRest: false,
    };
  }

  // Destructuring: function({ x, y }) or function([a, b])
  return {
    name: "",
    hasDefault: false,
    isRest: false,
  };
}

/** Extract all function callees from a node */
export function extractCallees(node: Node, _source: string): string[] {
  const callees = new Set<string>();

  walk.simple(node, {
    CallExpression(callNode: Node) {
      const call = callNode as CallExpressionNode;
      const name = getCalleeName(call.callee);
      if (name) {
        callees.add(name);
      }
    },
  });

  return Array.from(callees);
}

/** Get the name of a callee from a CallExpression */
function getCalleeName(callee: Node): string | null {
  // Direct call: foo()
  if (callee.type === "Identifier") {
    return (callee as IdentifierNode).name;
  }

  // Member call: obj.method() - return "method"
  if (callee.type === "MemberExpression") {
    const member = callee as MemberExpressionNode;
    if (!member.computed && member.property.type === "Identifier") {
      return (member.property as IdentifierNode).name;
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
    acorn.parse(source, {
      ecmaVersion: "latest",
      sourceType: "module",
    });
    return true;
  } catch {
    try {
      // Try as script (CommonJS)
      acorn.parse(source, {
        ecmaVersion: "latest",
        sourceType: "script",
      });
      return true;
    } catch {
      return false;
    }
  }
}
