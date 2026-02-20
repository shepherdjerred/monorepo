import * as acorn from "acorn";
import * as walk from "acorn-walk";
import type { Node } from "acorn";
import { parseAndExtractFunctions, extractCallees } from "./ast-parser.ts";
import {
  asImportDeclarationNode,
  asExportNamedDeclarationNode,
  asExportDefaultDeclarationNode,
  type ExportNamedDeclarationNode,
} from "./ast-node-schemas.ts";
import type {
  CallGraph,
  CodeSegment,
  DeminifyContext,
  DeminifyResult,
  ExtractedFunction,
  ExportInfo,
  FileContext,
  FunctionContext,
  ImportInfo,
} from "./types.ts";

/** Build a complete call graph from source code */
export function buildCallGraph(source: string): CallGraph {
  const functions = parseAndExtractFunctions(source);

  const functionsMap = new Map<string, ExtractedFunction>();
  const nameToId = new Map<string, string>();

  for (const func of functions) {
    functionsMap.set(func.id, func);
    if (func.originalName.length > 0) {
      nameToId.set(func.originalName, func.id);
    }
  }

  resolveCallers(functionsMap, nameToId);

  const { imports, exports: moduleExports } = extractImportsExports(source);
  const topLevelSegments = extractTopLevelSegments(source, functions);

  return {
    functions: functionsMap,
    nameToId,
    topLevelSegments,
    imports,
    exports: moduleExports,
    source,
  };
}

/** Resolve caller relationships (inverse of callees) */
function resolveCallers(
  functions: Map<string, ExtractedFunction>,
  nameToId: Map<string, string>,
): void {
  for (const [_id, func] of functions) {
    for (const calleeName of func.callees) {
      const calleeId = nameToId.get(calleeName);
      if (calleeId != null && calleeId.length > 0) {
        const callee = functions.get(calleeId);
        if (callee != null && !callee.callers.includes(func.id)) {
          callee.callers.push(func.id);
        }
      }
    }
  }
}

/** Extract import specifier name */
function getImportSpecifierName(s: {
  type: string;
  local: { name: string };
  imported?: { name: string } | undefined;
}): string {
  if (s.type === "ImportDefaultSpecifier") {
    return s.local.name;
  }
  if (s.type === "ImportNamespaceSpecifier") {
    return `* as ${s.local.name}`;
  }
  return s.imported?.name ?? s.local.name;
}

/** Extract named exports from an ExportNamedDeclaration node */
function extractNamedExports(
  exportNode: ExportNamedDeclarationNode,
  node: Node,
  exports: ExportInfo[],
): void {
  if (exportNode.declaration) {
    const decl = exportNode.declaration;
    if (decl.id) {
      exports.push({
        name: decl.id.name,
        localName: decl.id.name,
        start: node.start,
        end: node.end,
      });
    } else if (decl.declarations) {
      for (const d of decl.declarations) {
        exports.push({
          name: d.id.name,
          localName: d.id.name,
          start: node.start,
          end: node.end,
        });
      }
    }
  }
  for (const spec of exportNode.specifiers) {
    exports.push({
      name: spec.exported.name,
      localName: spec.local.name,
      start: node.start,
      end: node.end,
    });
  }
}

/** Extract import and export information */
function extractImportsExports(source: string): {
  imports: ImportInfo[];
  exports: ExportInfo[];
} {
  const imports: ImportInfo[] = [];
  const exports: ExportInfo[] = [];

  let ast: Node;
  try {
    ast = acorn.parse(source, {
      ecmaVersion: "latest",
      sourceType: "module",
    });
  } catch {
    return { imports, exports };
  }

  walk.simple(ast, {
    ImportDeclaration(node: Node) {
      const importNode = asImportDeclarationNode(node);
      if (!importNode) {
        return;
      }
      imports.push({
        source: importNode.source.value,
        specifiers: importNode.specifiers.map((s) => getImportSpecifierName(s)),
        start: node.start,
        end: node.end,
      });
    },
    ExportNamedDeclaration(node: Node) {
      const exportNode = asExportNamedDeclarationNode(node);
      if (!exportNode) {
        return;
      }
      extractNamedExports(exportNode, node, exports);
    },
    ExportDefaultDeclaration(node: Node) {
      const exportNode = asExportDefaultDeclarationNode(node);
      if (!exportNode) {
        return;
      }
      const name =
        exportNode.declaration.id?.name ??
        exportNode.declaration.name ??
        "default";
      exports.push({
        name: "default",
        localName: name,
        start: node.start,
        end: node.end,
      });
    },
  });

  return { imports, exports };
}

/** Extract top-level code segments (code not inside any function) */
function extractTopLevelSegments(
  source: string,
  functions: ExtractedFunction[],
): CodeSegment[] {
  const sortedFunctions = [...functions]
    .filter((f) => f.parentId == null || f.parentId.length === 0)
    .toSorted((a, b) => a.start - b.start);

  const segments: CodeSegment[] = [];
  let currentPos = 0;
  let segmentIndex = 0;

  for (const func of sortedFunctions) {
    if (func.start > currentPos) {
      const segmentSource = source.slice(currentPos, func.start);
      if (segmentSource.trim().length > 0) {
        segments.push({
          id: `segment_${String(segmentIndex++)}`,
          start: currentPos,
          end: func.start,
          source: segmentSource,
          callees: extractTopLevelCallees(segmentSource),
        });
      }
    }
    currentPos = func.end;
  }

  if (currentPos < source.length) {
    const segmentSource = source.slice(currentPos);
    if (segmentSource.trim().length > 0) {
      segments.push({
        id: `segment_${String(segmentIndex)}`,
        start: currentPos,
        end: source.length,
        source: segmentSource,
        callees: extractTopLevelCallees(segmentSource),
      });
    }
  }

  return segments;
}

/** Extract callees from a top-level code segment */
function extractTopLevelCallees(source: string): string[] {
  try {
    const ast = acorn.parse(source, {
      ecmaVersion: "latest",
      sourceType: "module",
      allowReturnOutsideFunction: true,
    });
    return extractCallees(ast, source);
  } catch {
    return [];
  }
}

/** Get optimal processing order (leaf functions first) */
export function getProcessingOrder(graph: CallGraph): string[] {
  const order: string[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(id: string): void {
    if (visited.has(id)) {
      return;
    }
    if (visiting.has(id)) {
      if (!visited.has(id)) {
        order.push(id);
        visited.add(id);
      }
      return;
    }

    visiting.add(id);
    const func = graph.functions.get(id);
    if (func) {
      for (const calleeName of func.callees) {
        const calleeId = graph.nameToId.get(calleeName);
        if (
          calleeId != null &&
          calleeId.length > 0 &&
          graph.functions.has(calleeId)
        ) {
          visit(calleeId);
        }
      }
    }
    visiting.delete(id);
    visited.add(id);
    order.push(id);
  }

  const roots = [...graph.functions.values()].filter(
    (f) => f.callers.length === 0,
  );
  for (const root of roots) {
    visit(root.id);
  }

  for (const id of graph.functions.keys()) {
    visit(id);
  }

  return order;
}

/** Extract a cycle from the stack starting at the given ID */
function extractCycle(
  stack: string[],
  startId: string,
  cycles: string[][],
): void {
  const cycleStart = stack.indexOf(startId);
  if (cycleStart !== -1) {
    const cycle = stack.slice(cycleStart);
    if (cycle.length > 1) {
      cycles.push(cycle);
    }
  }
}

/** Find strongly connected components (cycles) */
export function findCycles(graph: CallGraph): string[][] {
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const stack: string[] = [];
  const onStack = new Set<string>();

  function strongConnect(id: string): void {
    visited.add(id);
    stack.push(id);
    onStack.add(id);

    const func = graph.functions.get(id);
    if (func) {
      for (const calleeName of func.callees) {
        const calleeId = graph.nameToId.get(calleeName);
        if (
          calleeId == null ||
          calleeId.length === 0 ||
          !graph.functions.has(calleeId)
        ) {
          continue;
        }

        if (!visited.has(calleeId)) {
          strongConnect(calleeId);
        } else if (onStack.has(calleeId)) {
          extractCycle(stack, calleeId, cycles);
        }
      }
    }

    stack.pop();
    onStack.delete(id);
  }

  for (const id of graph.functions.keys()) {
    if (!visited.has(id)) {
      strongConnect(id);
    }
  }

  return cycles;
}

/** Build a FunctionContext from a function and optional result */
function buildFunctionContext(
  func: ExtractedFunction,
  result: DeminifyResult | undefined,
  id: string,
): FunctionContext {
  return {
    id,
    originalSource: truncateSource(func.source, 500),
    deminifiedSource: result
      ? truncateSource(result.deminifiedSource, 500)
      : null,
    suggestedName: result?.suggestedName ?? null,
  };
}

/** Build known names map from deminified results */
function buildKnownNames(
  graph: CallGraph,
  deminifiedResults: Map<string, DeminifyResult>,
): Map<string, string> {
  const knownNames = new Map<string, string>();
  for (const [id, result] of deminifiedResults) {
    const graphFunc = graph.functions.get(id);
    if (
      graphFunc?.originalName != null &&
      graphFunc.originalName.length > 0 &&
      result.suggestedName.length > 0
    ) {
      knownNames.set(graphFunc.originalName, result.suggestedName);
    }
    for (const [orig, suggested] of Object.entries(result.parameterNames)) {
      knownNames.set(orig, suggested);
    }
    for (const [orig, suggested] of Object.entries(result.localVariableNames)) {
      knownNames.set(orig, suggested);
    }
  }
  return knownNames;
}

/** Get context for de-minifying a specific function */
export function getFunctionContext(
  graph: CallGraph,
  functionId: string,
  deminifiedResults: Map<string, DeminifyResult>,
  fileContext: FileContext,
): DeminifyContext {
  const func = graph.functions.get(functionId);
  if (!func) {
    throw new Error(`Function not found: ${functionId}`);
  }

  const callers: FunctionContext[] = func.callers
    .map((callerId) => {
      const caller = graph.functions.get(callerId);
      if (!caller) {
        return null;
      }
      return buildFunctionContext(
        caller,
        deminifiedResults.get(callerId),
        callerId,
      );
    })
    .filter((c) => c !== null)
    .slice(0, 3);

  const callees: FunctionContext[] = func.callees
    .map((calleeName) => {
      const calleeId = graph.nameToId.get(calleeName);
      if (calleeId == null || calleeId.length === 0) {
        return null;
      }
      const callee = graph.functions.get(calleeId);
      if (!callee) {
        return null;
      }
      return buildFunctionContext(
        callee,
        deminifiedResults.get(calleeId),
        calleeId,
      );
    })
    .filter((c) => c !== null)
    .slice(0, 5);

  const knownNames = buildKnownNames(graph, deminifiedResults);

  return {
    targetFunction: func,
    callers,
    callees,
    knownNames,
    fileContext,
  };
}

/** Truncate source for context (avoid huge prompts) */
function truncateSource(source: string, maxLength: number): string {
  if (source.length <= maxLength) {
    return source;
  }
  return source.slice(0, maxLength) + "... [truncated]";
}

/** Get statistics about the call graph */
export function getGraphStats(graph: CallGraph): {
  functionCount: number;
  topLevelCount: number;
  nestedCount: number;
  avgCallees: number;
  maxCallees: number;
  cycleCount: number;
} {
  const functions = [...graph.functions.values()];
  const topLevel = functions.filter(
    (f) => f.parentId == null || f.parentId.length === 0,
  );
  const nested = functions.filter(
    (f) => f.parentId != null && f.parentId.length > 0,
  );
  const callees = functions.map((f) => f.callees.length);
  const cycles = findCycles(graph);

  return {
    functionCount: functions.length,
    topLevelCount: topLevel.length,
    nestedCount: nested.length,
    avgCallees:
      callees.length > 0
        ? callees.reduce((a, b) => a + b, 0) / callees.length
        : 0,
    maxCallees: Math.max(0, ...callees),
    cycleCount: cycles.length,
  };
}
