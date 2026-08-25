import type { CstNode, IToken } from "chevrotain";
import type {
  ScoutQlDiagnostic,
  ScoutQlSpan,
} from "#src/model/scoutql/diagnostics.ts";
import type {
  ScoutQlBinaryOp,
  ScoutQlExprAst,
} from "#src/model/scoutql/ast.ts";
import { unionSpan } from "#src/model/scoutql/ast.ts";

// ── CST→AST shared machinery ─────────────────────────────────────────────────
// Typed access into Chevrotain's untyped CST children, span sanitation, the
// visitor's diagnostic state, and the depth/size budget that keeps pathological
// input from stack-overflowing later passes.

export const SCOUTQL_MAX_EXPRESSION_DEPTH = 16;
export const SCOUTQL_MAX_EXPRESSION_NODES = 500;

export type VisitState = {
  readonly diagnostics: ScoutQlDiagnostic[];
  nodeCount: number;
  depthReported: boolean;
  sizeReported: boolean;
};

export function newVisitState(): VisitState {
  return {
    diagnostics: [],
    nodeCount: 0,
    depthReported: false,
    sizeReported: false,
  };
}

// Runtime shape checks that THROW on violation instead of casting: a CST child
// of the wrong shape is a parser bug and fails fast.
export function ruleChildren(node: CstNode, key: string): CstNode[] {
  const elements = node.children[key];
  if (elements === undefined) {
    return [];
  }
  const nodes: CstNode[] = [];
  for (const element of elements) {
    if (!("children" in element)) {
      throw new Error(
        `ScoutQL CST: child "${key}" of ${node.name} is a token, expected a rule node.`,
      );
    }
    nodes.push(element);
  }
  return nodes;
}

export function tokenChildren(node: CstNode, key: string): IToken[] {
  const elements = node.children[key];
  if (elements === undefined) {
    return [];
  }
  const tokens: IToken[] = [];
  for (const element of elements) {
    if ("children" in element) {
      throw new Error(
        `ScoutQL CST: child "${key}" of ${node.name} is a rule node, expected a token.`,
      );
    }
    tokens.push(element);
  }
  return tokens;
}

export function hasChild(node: CstNode, key: string): boolean {
  return (node.children[key]?.length ?? 0) > 0;
}

/**
 * Half-open span of a CST node, or the fallback when the node was produced by
 * error recovery and carries no (or negative sentinel) location.
 */
export function cstSpan(node: CstNode, fallback: ScoutQlSpan): ScoutQlSpan {
  const location = node.location;
  if (location === undefined) {
    return fallback;
  }
  const { startOffset, endOffset } = location;
  if (
    endOffset === undefined ||
    startOffset < 0 ||
    endOffset < startOffset ||
    !Number.isFinite(startOffset) ||
    !Number.isFinite(endOffset)
  ) {
    return fallback;
  }
  return { start: startOffset, end: endOffset + 1 };
}

/** Depth guard for structural descents; reports "expression-too-deep" once. */
export function guardDepth(
  state: VisitState,
  depth: number,
  span: ScoutQlSpan,
): boolean {
  if (depth <= SCOUTQL_MAX_EXPRESSION_DEPTH) {
    return true;
  }
  if (!state.depthReported) {
    state.depthReported = true;
    state.diagnostics.push({
      code: "expression-too-deep",
      severity: "error",
      message: `Expression nesting exceeds the maximum depth of ${String(SCOUTQL_MAX_EXPRESSION_DEPTH)}.`,
      span,
    });
  }
  return false;
}

/** Node budget for AST construction; reports "expression-too-large" once. */
export function countNode(state: VisitState, span: ScoutQlSpan): boolean {
  state.nodeCount += 1;
  if (state.nodeCount <= SCOUTQL_MAX_EXPRESSION_NODES) {
    return true;
  }
  if (!state.sizeReported) {
    state.sizeReported = true;
    state.diagnostics.push({
      code: "expression-too-large",
      severity: "error",
      message: `Query exceeds the maximum of ${String(SCOUTQL_MAX_EXPRESSION_NODES)} expression nodes.`,
      span,
    });
  }
  return false;
}

const COMPARE_OPS = new Map<string, ScoutQlBinaryOp>([
  ["Equals", "="],
  ["NotEquals", "!="],
  ["LtGt", "!="], // <> normalizes to !=
  ["Less", "<"],
  ["LessEqual", "<="],
  ["Greater", ">"],
  ["GreaterEqual", ">="],
]);

/** The comparison operator held by a `compOp` CST node. */
export function compareOpOf(compOpNode: CstNode): ScoutQlBinaryOp {
  for (const elements of Object.values(compOpNode.children)) {
    for (const element of elements) {
      if (!("children" in element)) {
        const op = COMPARE_OPS.get(element.tokenType.name);
        if (op !== undefined) {
          return op;
        }
      }
    }
  }
  throw new Error("ScoutQL CST: compOp node holds no comparison operator.");
}

// ── Compact node factories ───────────────────────────────────────────────────

export function errorNode(span: ScoutQlSpan): ScoutQlExprAst {
  return { kind: "error", span };
}

export function binaryNode(
  op: ScoutQlBinaryOp,
  operands: { left: ScoutQlExprAst; right: ScoutQlExprAst },
  span?: ScoutQlSpan,
): ScoutQlExprAst {
  const { left, right } = operands;
  return {
    kind: "binary",
    op,
    left,
    right,
    span: span ?? unionSpan(left.span, right.span),
  };
}

export function notNode(
  operand: ScoutQlExprAst,
  span: ScoutQlSpan,
): ScoutQlExprAst {
  return { kind: "unary", op: "not", operand, span };
}
