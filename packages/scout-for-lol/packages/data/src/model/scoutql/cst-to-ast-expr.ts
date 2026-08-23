import type { CstNode } from "chevrotain";
import type { ScoutQlSpan } from "#src/model/scoutql/diagnostics.ts";
import type {
  ScoutQlBinaryOp,
  ScoutQlExprAst,
} from "#src/model/scoutql/ast.ts";
import { unionSpan } from "#src/model/scoutql/ast.ts";
import {
  binaryNode,
  compareOpOf,
  countNode,
  cstSpan,
  errorNode,
  guardDepth,
  hasChild,
  notNode,
  ruleChildren,
  tokenChildren,
  type VisitState,
} from "#src/model/scoutql/cst-to-ast-shared.ts";
import {
  decodeScoutQlIdentifier,
  decodeScoutQlString,
  tokenSpan,
} from "#src/model/scoutql/tokens.ts";

// ── Expression ladder visitor ────────────────────────────────────────────────
// Mirrors the parser's precedence ladder. Depth increments on STRUCTURAL
// descents (parens, call args, prefix operators, comparison operands) rather
// than per ladder pass-through or per chain operand, so a long flat AND chain
// stays cheap while genuinely nested expressions hit the cap.

type ExprVisitor = (
  node: CstNode,
  depth: number,
  state: VisitState,
  fallback: ScoutQlSpan,
) => ScoutQlExprAst;

export function visitExpr(
  node: CstNode,
  depth: number,
  state: VisitState,
  fallback: ScoutQlSpan,
): ScoutQlExprAst {
  const span = cstSpan(node, fallback);
  const [orNode] = ruleChildren(node, "orExpr");
  if (orNode === undefined) {
    return errorNode(span);
  }
  return visitOr(orNode, depth, state, span);
}

type ChainSpec = {
  childKey: string;
  ops: readonly { key: string; op: ScoutQlBinaryOp }[];
  visitChild: ExprVisitor;
};

/** Left-folds `child (op child)*` chains into binary nodes. */
function chainVisitor(spec: ChainSpec): ExprVisitor {
  return (node, depth, state, fallback) => {
    const span = cstSpan(node, fallback);
    const [firstNode, ...restNodes] = ruleChildren(node, spec.childKey);
    if (firstNode === undefined) {
      return errorNode(span);
    }
    const childDepth = restNodes.length === 0 ? depth : depth + 1;
    if (restNodes.length > 0 && !guardDepth(state, childDepth, span)) {
      return errorNode(span);
    }
    let result = spec.visitChild(firstNode, childDepth, state, span);
    if (restNodes.length === 0) {
      return result;
    }
    const opEvents: { offset: number; op: ScoutQlBinaryOp }[] = [];
    for (const { key, op } of spec.ops) {
      for (const token of tokenChildren(node, key)) {
        opEvents.push({ offset: token.startOffset, op });
      }
    }
    opEvents.sort((a, b) => a.offset - b.offset);
    for (const [index, operandNode] of restNodes.entries()) {
      const right = spec.visitChild(operandNode, childDepth, state, span);
      const op = opEvents[index]?.op ?? opEvents.at(-1)?.op;
      if (op === undefined) {
        // Recovery left an operand without its operator — keep what we folded.
        return result;
      }
      if (!countNode(state, span)) {
        return errorNode(span);
      }
      result = binaryNode(op, { left: result, right });
    }
    return result;
  };
}

function visitNot(
  node: CstNode,
  depth: number,
  state: VisitState,
  fallback: ScoutQlSpan,
): ScoutQlExprAst {
  const span = cstSpan(node, fallback);
  const [innerNot] = ruleChildren(node, "notExpr");
  if (innerNot !== undefined || tokenChildren(node, "Not").length > 0) {
    if (
      innerNot === undefined ||
      !guardDepth(state, depth + 1, span) ||
      !countNode(state, span)
    ) {
      return errorNode(span);
    }
    return notNode(visitNot(innerNot, depth + 1, state, span), span);
  }
  const [comparisonNode] = ruleChildren(node, "comparison");
  if (comparisonNode === undefined) {
    return errorNode(span);
  }
  return visitComparison(comparisonNode, depth, state, span);
}

function additiveOr(
  node: CstNode | undefined,
  depth: number,
  state: VisitState,
  fallback: ScoutQlSpan,
): ScoutQlExprAst {
  if (node === undefined) {
    return errorNode(fallback);
  }
  return visitAdditive(node, depth, state, fallback);
}

function comparisonHasSuffix(node: CstNode, negated: boolean): boolean {
  return (
    negated ||
    hasChild(node, "compOp") ||
    hasChild(node, "Is") ||
    hasChild(node, "In") ||
    hasChild(node, "Between") ||
    hasChild(node, "Like") ||
    hasChild(node, "Ilike")
  );
}

function visitComparison(
  node: CstNode,
  depth: number,
  state: VisitState,
  fallback: ScoutQlSpan,
): ScoutQlExprAst {
  const span = cstSpan(node, fallback);
  const additiveNodes = ruleChildren(node, "additive");
  const [operandNode] = additiveNodes;
  if (operandNode === undefined) {
    return errorNode(span);
  }
  const [compOpNode] = ruleChildren(node, "compOp");
  const negated = tokenChildren(node, "Not").length > 0;
  const hasSuffix = comparisonHasSuffix(node, negated);
  const operandDepth = hasSuffix ? depth + 1 : depth;
  if (hasSuffix && !guardDepth(state, operandDepth, span)) {
    return errorNode(span);
  }
  const operand = visitAdditive(operandNode, operandDepth, state, span);
  if (!hasSuffix) {
    return operand;
  }
  if (!countNode(state, span)) {
    return errorNode(span);
  }
  if (compOpNode !== undefined) {
    const right = additiveOr(additiveNodes[1], operandDepth, state, span);
    return binaryNode(compareOpOf(compOpNode), { left: operand, right }, span);
  }
  if (hasChild(node, "Is")) {
    return { kind: "is-null", operand, negated, span };
  }
  if (hasChild(node, "In")) {
    const items = ruleChildren(node, "expr").map((item) =>
      visitExpr(item, operandDepth, state, span),
    );
    return { kind: "in", operand, negated, items, span };
  }
  if (hasChild(node, "Between")) {
    const low = additiveOr(additiveNodes[1], operandDepth, state, span);
    const high = additiveOr(additiveNodes[2], operandDepth, state, span);
    return { kind: "between", operand, negated, low, high, span };
  }
  if (hasChild(node, "Like") || hasChild(node, "Ilike")) {
    const op: ScoutQlBinaryOp = hasChild(node, "Ilike") ? "ilike" : "like";
    const right = additiveOr(additiveNodes[1], operandDepth, state, span);
    const like = binaryNode(op, { left: operand, right }, span);
    return negated ? notNode(like, span) : like;
  }
  // Recovery consumed NOT but lost its IN/BETWEEN/LIKE suffix.
  return errorNode(span);
}

function typeNameOf(typeNode: CstNode): string {
  const [identifier] = tokenChildren(typeNode, "Identifier");
  if (identifier === undefined) {
    return "";
  }
  return decodeScoutQlIdentifier(identifier.image);
}

function visitPostfix(
  node: CstNode,
  depth: number,
  state: VisitState,
  fallback: ScoutQlSpan,
): ScoutQlExprAst {
  const span = cstSpan(node, fallback);
  const [unaryNode] = ruleChildren(node, "unary");
  if (unaryNode === undefined) {
    return errorNode(span);
  }
  const typeNames = ruleChildren(node, "typeName");
  const colonTokens = tokenChildren(node, "DoubleColon");
  const atTokens = tokenChildren(node, "At");
  const timezoneLiterals = tokenChildren(node, "StringLiteral");
  const hasOps = typeNames.length > 0 || atTokens.length > 0;
  const operandDepth = hasOps ? depth + 1 : depth;
  if (hasOps && !guardDepth(state, operandDepth, span)) {
    return errorNode(span);
  }
  let result = visitUnary(unaryNode, operandDepth, state, span);
  type PostfixEvent = {
    offset: number;
    apply: (operand: ScoutQlExprAst) => ScoutQlExprAst;
  };
  const events: PostfixEvent[] = [];
  typeNames.forEach((typeNode, index) => {
    const typeSpan = cstSpan(typeNode, span);
    events.push({
      offset: colonTokens[index]?.startOffset ?? typeSpan.start,
      apply: (operand) => ({
        kind: "cast",
        operand,
        to: typeNameOf(typeNode),
        form: "operator",
        span: unionSpan(operand.span, typeSpan),
      }),
    });
  });
  atTokens.forEach((atToken, index) => {
    const literal = timezoneLiterals[index];
    if (literal === undefined) {
      return;
    }
    const literalSpan = tokenSpan(literal) ?? span;
    events.push({
      offset: atToken.startOffset,
      apply: (operand) =>
        binaryNode("at-time-zone", {
          left: operand,
          right: {
            kind: "string",
            value: decodeScoutQlString(literal.image),
            span: literalSpan,
          },
        }),
    });
  });
  events.sort((a, b) => a.offset - b.offset);
  for (const event of events) {
    if (!countNode(state, span)) {
      return errorNode(span);
    }
    result = event.apply(result);
  }
  return result;
}

function visitUnary(
  node: CstNode,
  depth: number,
  state: VisitState,
  fallback: ScoutQlSpan,
): ScoutQlExprAst {
  const span = cstSpan(node, fallback);
  if (hasChild(node, "Minus")) {
    const [inner] = ruleChildren(node, "unary");
    if (
      inner === undefined ||
      !guardDepth(state, depth + 1, span) ||
      !countNode(state, span)
    ) {
      return errorNode(span);
    }
    const operand = visitUnary(inner, depth + 1, state, span);
    return { kind: "unary", op: "-", operand, span };
  }
  const [primaryNode] = ruleChildren(node, "primary");
  if (primaryNode === undefined) {
    return errorNode(span);
  }
  return visitPrimary(primaryNode, depth, state, span);
}

function intervalNode(node: CstNode, span: ScoutQlSpan): ScoutQlExprAst {
  const [stringToken] = tokenChildren(node, "StringLiteral");
  if (stringToken !== undefined) {
    const decoded = decodeScoutQlString(stringToken.image);
    const match = /^\s*(\d+(?:\.\d+)?)\s+([a-z_]+)\s*$/i.exec(decoded);
    const amountText = match?.[1];
    const unitText = match?.[2];
    if (amountText === undefined || unitText === undefined) {
      return {
        kind: "interval",
        amount: null,
        unit: null,
        form: "string",
        span,
      };
    }
    return {
      kind: "interval",
      amount: Number(amountText),
      unit: unitText.toLowerCase(),
      form: "string",
      span,
    };
  }
  const [numberToken] = tokenChildren(node, "NumberLiteral");
  if (numberToken === undefined) {
    return errorNode(span);
  }
  const [unitToken] = tokenChildren(node, "Identifier");
  return {
    kind: "interval",
    amount: Number(numberToken.image),
    unit:
      unitToken === undefined ? null : decodeScoutQlIdentifier(unitToken.image),
    form: "number",
    span,
  };
}

function visitPrimary(
  node: CstNode,
  depth: number,
  state: VisitState,
  fallback: ScoutQlSpan,
): ScoutQlExprAst {
  const span = cstSpan(node, fallback);
  if (!countNode(state, span)) {
    return errorNode(span);
  }
  if (hasChild(node, "Interval")) {
    return intervalNode(node, span);
  }
  if (hasChild(node, "Cast")) {
    const [exprNode] = ruleChildren(node, "expr");
    const [typeNode] = ruleChildren(node, "typeName");
    if (exprNode === undefined || !guardDepth(state, depth + 1, span)) {
      return errorNode(span);
    }
    return {
      kind: "cast",
      operand: visitExpr(exprNode, depth + 1, state, span),
      to: typeNode === undefined ? "" : typeNameOf(typeNode),
      form: "function",
      span,
    };
  }
  const [callNode] = ruleChildren(node, "callOrColumn");
  if (callNode !== undefined) {
    return visitCallOrColumn(callNode, depth, state, span);
  }
  if (hasChild(node, "LParen")) {
    const [exprNode] = ruleChildren(node, "expr");
    if (exprNode === undefined || !guardDepth(state, depth + 1, span)) {
      return errorNode(span);
    }
    return visitExpr(exprNode, depth + 1, state, span);
  }
  const [numberToken] = tokenChildren(node, "NumberLiteral");
  if (numberToken !== undefined) {
    return { kind: "number", value: Number(numberToken.image), span };
  }
  const [stringToken] = tokenChildren(node, "StringLiteral");
  if (stringToken !== undefined) {
    return {
      kind: "string",
      value: decodeScoutQlString(stringToken.image),
      span,
    };
  }
  if (hasChild(node, "True")) {
    return { kind: "boolean", value: true, span };
  }
  if (hasChild(node, "False")) {
    return { kind: "boolean", value: false, span };
  }
  if (hasChild(node, "Null")) {
    return { kind: "null", span };
  }
  if (hasChild(node, "CurrentTimestamp")) {
    return { kind: "now", which: "timestamp", span };
  }
  if (hasChild(node, "CurrentDate")) {
    return { kind: "now", which: "date", span };
  }
  return errorNode(span);
}

function visitCallOrColumn(
  node: CstNode,
  depth: number,
  state: VisitState,
  fallback: ScoutQlSpan,
): ScoutQlExprAst {
  const span = cstSpan(node, fallback);
  const nameToken =
    tokenChildren(node, "Identifier")[0] ?? tokenChildren(node, "Group")[0];
  if (nameToken === undefined) {
    return errorNode(span);
  }
  const name = decodeScoutQlIdentifier(nameToken.image);
  if (!hasChild(node, "LParen")) {
    return { kind: "column", name, span };
  }
  const [argsNode] = ruleChildren(node, "callArgs");
  let args: ScoutQlExprAst[] = [];
  if (argsNode !== undefined) {
    const argNodes = ruleChildren(argsNode, "expr");
    if (argNodes.length > 0) {
      if (!guardDepth(state, depth + 1, span)) {
        return errorNode(span);
      }
      args = argNodes.map((argNode) =>
        visitExpr(argNode, depth + 1, state, span),
      );
    }
  }
  let filter: ScoutQlExprAst | undefined;
  const [filterNode] = ruleChildren(node, "filterSuffix");
  if (filterNode !== undefined) {
    const [filterExpr] = ruleChildren(filterNode, "expr");
    const filterSpan = cstSpan(filterNode, span);
    if (filterExpr !== undefined && guardDepth(state, depth + 1, filterSpan)) {
      filter = visitExpr(filterExpr, depth + 1, state, filterSpan);
    }
  }
  return {
    kind: "call",
    name,
    star: argsNode !== undefined && hasChild(argsNode, "Star"),
    distinct: argsNode !== undefined && hasChild(argsNode, "Distinct"),
    all: argsNode !== undefined && hasChild(argsNode, "All"),
    args,
    filter,
    span,
  };
}

// Chain levels, bottom-up so each const is initialized before the one that
// closes over it (function-declaration visitors hoist).
const visitMultiplicative = chainVisitor({
  childKey: "postfix",
  ops: [
    { key: "Star", op: "*" },
    { key: "Slash", op: "/" },
    { key: "Percent", op: "%" },
  ],
  visitChild: visitPostfix,
});

const visitAdditive = chainVisitor({
  childKey: "multiplicative",
  ops: [
    { key: "Plus", op: "+" },
    { key: "Minus", op: "-" },
  ],
  visitChild: visitMultiplicative,
});

const visitAnd = chainVisitor({
  childKey: "notExpr",
  ops: [{ key: "And", op: "and" }],
  visitChild: visitNot,
});

const visitOr = chainVisitor({
  childKey: "andExpr",
  ops: [{ key: "Or", op: "or" }],
  visitChild: visitAnd,
});
