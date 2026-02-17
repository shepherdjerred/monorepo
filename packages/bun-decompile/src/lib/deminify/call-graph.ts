import * as acorn from "acorn";
import * as walk from "acorn-walk";
import type { Node } from "acorn";
import { parseAndExtractFunctions, extractCallees } from "./ast-parser.ts";
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

/** Extended node types */
type ImportDeclarationNode = {
  source: { value: string };
  specifiers: {
    type: string;
    local: { name: string };
    imported?: { name: string };
  }[];
} & Node;

type ExportNamedDeclarationNode = {
  declaration?: Node & {
    id?: { name: string };
    declarations?: { id: { name: string } }[];
  };
  specifiers: {
    local: { name: string };
    exported: { name: string };
  }[];
} & Node;

type ExportDefaultDeclarationNode = {
  declaration: Node & { id?: { name: string }; name?: string };
} & Node;

/** Build a complete call graph from source code */
export function buildCallGraph(source: string): CallGraph {
  // Parse and extract functions
  const functions = parseAndExtractFunctions(source);

  // Create maps
  const functionsMap = new Map<string, ExtractedFunction>();
  const nameToId = new Map<string, string>();

  for (const func of functions) {
    functionsMap.set(func.id, func);
    if (func.originalName) {
      nameToId.set(func.originalName, func.id);
    }
  }

  // Resolve callers (inverse of callees)
  resolveCallers(functionsMap, nameToId);

  // Extract imports and exports
  const { imports, exports: moduleExports } = extractImportsExports(source);

  // Extract top-level segments
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
      if (calleeId) {
        const callee = functions.get(calleeId);
        if (callee && !callee.callers.includes(func.id)) {
          callee.callers.push(func.id);
        }
      }
    }
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
    // Not a module, no imports/exports
    return { imports, exports };
  }

  walk.simple(ast, {
    ImportDeclaration(node: Node) {
      const importNode = node as ImportDeclarationNode;
      imports.push({
        source: importNode.source.value,
        specifiers: importNode.specifiers.map((s) => {
          if (s.type === "ImportDefaultSpecifier") {
            return s.local.name;
          }
          if (s.type === "ImportNamespaceSpecifier") {
            return `* as ${s.local.name}`;
          }
          return s.imported?.name ?? s.local.name;
        }),
        start: node.start,
        end: node.end,
      });
    },
    ExportNamedDeclaration(node: Node) {
      const exportNode = node as ExportNamedDeclarationNode;
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
    },
    ExportDefaultDeclaration(node: Node) {
      const exportNode = node as ExportDefaultDeclarationNode;
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
  // Sort functions by start position
  const sortedFunctions = [...functions]
    .filter((f) => !f.parentId) // Only top-level functions
    .sort((a, b) => a.start - b.start);

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

  // Add final segment
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
    // May fail on partial code, just return empty
    return [];
  }
}

/** Get optimal processing order (leaf functions first) */
export function getProcessingOrder(graph: CallGraph): string[] {
  const order: string[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  // Topological sort with cycle detection
  function visit(id: string): void {
    if (visited.has(id)) {
      return;
    }
    if (visiting.has(id)) {
      // Cycle detected, just add to order
      if (!visited.has(id)) {
        order.push(id);
        visited.add(id);
      }
      return;
    }

    visiting.add(id);
    const func = graph.functions.get(id);
    if (func) {
      // Visit callees first (dependencies)
      for (const calleeName of func.callees) {
        const calleeId = graph.nameToId.get(calleeName);
        if (calleeId && graph.functions.has(calleeId)) {
          visit(calleeId);
        }
      }
    }
    visiting.delete(id);
    visited.add(id);
    order.push(id);
  }

  // Start from functions with no callers (entry points)
  const roots = [...graph.functions.values()].filter(
    (f) => f.callers.length === 0,
  );
  for (const root of roots) {
    visit(root.id);
  }

  // Visit any remaining functions (in cycles)
  for (const id of graph.functions.keys()) {
    visit(id);
  }

  return order;
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
        if (!calleeId || !graph.functions.has(calleeId)) {
          continue;
        }

        if (!visited.has(calleeId)) {
          strongConnect(calleeId);
        } else if (onStack.has(calleeId)) {
          // Found cycle
          const cycleStart = stack.indexOf(calleeId);
          if (cycleStart !== -1) {
            const cycle = stack.slice(cycleStart);
            if (cycle.length > 1) {
              cycles.push(cycle);
            }
          }
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

  // Get caller contexts
  const callers: FunctionContext[] = func.callers
    .map((callerId) => {
      const caller = graph.functions.get(callerId);
      if (!caller) {
        return null;
      }
      const result = deminifiedResults.get(callerId);
      return {
        id: callerId,
        originalSource: truncateSource(caller.source, 500),
        deminifiedSource: result
          ? truncateSource(result.deminifiedSource, 500)
          : null,
        suggestedName: result?.suggestedName ?? null,
      };
    })
    .filter((c): c is FunctionContext => c !== null)
    .slice(0, 3); // Limit to 3 callers

  // Get callee contexts
  const callees: FunctionContext[] = func.callees
    .map((calleeName) => {
      const calleeId = graph.nameToId.get(calleeName);
      if (!calleeId) {
        return null;
      }
      const callee = graph.functions.get(calleeId);
      if (!callee) {
        return null;
      }
      const result = deminifiedResults.get(calleeId);
      return {
        id: calleeId,
        originalSource: truncateSource(callee.source, 500),
        deminifiedSource: result
          ? truncateSource(result.deminifiedSource, 500)
          : null,
        suggestedName: result?.suggestedName ?? null,
      };
    })
    .filter((c): c is FunctionContext => c !== null)
    .slice(0, 5); // Limit to 5 callees

  // Build known names map from results
  const knownNames = new Map<string, string>();
  for (const [id, result] of deminifiedResults) {
    const graphFunc = graph.functions.get(id);
    if (graphFunc?.originalName && result.suggestedName) {
      knownNames.set(graphFunc.originalName, result.suggestedName);
    }
    // Add parameter and variable mappings
    for (const [orig, suggested] of Object.entries(result.parameterNames)) {
      knownNames.set(orig, suggested);
    }
    for (const [orig, suggested] of Object.entries(result.localVariableNames)) {
      knownNames.set(orig, suggested);
    }
  }

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
  const topLevel = functions.filter((f) => !f.parentId);
  const nested = functions.filter((f) => f.parentId);
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
