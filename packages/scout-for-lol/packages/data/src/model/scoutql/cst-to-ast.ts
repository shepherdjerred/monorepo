import type { CstNode } from "chevrotain";
import type {
  ScoutQlDiagnostic,
  ScoutQlSpan,
} from "#src/model/scoutql/diagnostics.ts";
import type {
  ScoutQlExprAst,
  ScoutQlQueryAst,
  ScoutQlRenderListItemAst,
  ScoutQlRenderOptionAst,
  ScoutQlRenderValueAst,
  ScoutQlSelectItemAst,
} from "#src/model/scoutql/ast.ts";
import {
  cstSpan,
  hasChild,
  newVisitState,
  ruleChildren,
  tokenChildren,
  type VisitState,
} from "#src/model/scoutql/cst-to-ast-shared.ts";
import { visitExpr } from "#src/model/scoutql/cst-to-ast-expr.ts";
import {
  decodeScoutQlIdentifier,
  decodeScoutQlString,
  tokenSpan,
} from "#src/model/scoutql/tokens.ts";

// ── CST → AST visitor (statement level) ──────────────────────────────────────
// Tolerant by construction: a recovered/partial CST yields a partial AST, never
// a throw. The only throws are typed-access violations (cst-to-ast-shared.ts) —
// a CST child of the wrong shape is a parser bug and fails fast. The
// expression ladder lives in cst-to-ast-expr.ts; depth/size caps live in
// cst-to-ast-shared.ts.

function visitSelectItem(
  node: CstNode,
  state: VisitState,
  fallback: ScoutQlSpan,
): ScoutQlSelectItemAst {
  const span = cstSpan(node, fallback);
  const [exprNode] = ruleChildren(node, "expr");
  const expr: ScoutQlExprAst =
    exprNode === undefined
      ? { kind: "error", span }
      : visitExpr(exprNode, 1, state, span);
  const [aliasToken] = tokenChildren(node, "Identifier");
  const aliasSpan = aliasToken === undefined ? null : tokenSpan(aliasToken);
  const alias =
    aliasToken === undefined || aliasSpan === null
      ? null
      : decodeScoutQlIdentifier(aliasToken.image);
  return { expr, alias, aliasSpan: alias === null ? null : aliasSpan, span };
}

function visitRenderValue(
  node: CstNode,
  fallback: ScoutQlSpan,
): ScoutQlRenderValueAst {
  const span = cstSpan(node, fallback);
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
  const [hexToken] = tokenChildren(node, "HexColor");
  if (hexToken !== undefined) {
    return { kind: "hex-color", value: hexToken.image.toLowerCase(), span };
  }
  // A value that spells a keyword (`sort = desc`, `mentions = all`,
  // `sparkline = true`) arrives under the category key; its image is the word.
  const [keywordToken] = tokenChildren(node, "KeywordLike");
  if (keywordToken !== undefined) {
    const word = keywordToken.image.toLowerCase();
    if (word === "true" || word === "false") {
      return { kind: "boolean", value: word === "true", span };
    }
    return { kind: "identifier", name: word, span };
  }
  const [identifierToken] = tokenChildren(node, "Identifier");
  if (identifierToken !== undefined) {
    return {
      kind: "identifier",
      name: decodeScoutQlIdentifier(identifierToken.image),
      span,
    };
  }
  const listItems = ruleChildren(node, "renderListItem");
  if (listItems.length > 0) {
    return {
      kind: "list",
      items: listItems.map((item) => visitRenderListItem(item, span)),
      span,
    };
  }
  return { kind: "identifier", name: "", span };
}

function visitRenderListItem(
  node: CstNode,
  fallback: ScoutQlSpan,
): ScoutQlRenderListItemAst {
  const span = cstSpan(node, fallback);
  const [hexToken] = tokenChildren(node, "HexColor");
  if (hexToken !== undefined) {
    return { kind: "hex-color", value: hexToken.image.toLowerCase(), span };
  }
  const [stringToken] = tokenChildren(node, "StringLiteral");
  if (stringToken !== undefined) {
    return {
      kind: "string",
      value: decodeScoutQlString(stringToken.image),
      span,
    };
  }
  const [numberToken] = tokenChildren(node, "NumberLiteral");
  if (numberToken !== undefined) {
    return { kind: "number", value: Number(numberToken.image), span };
  }
  const [pairNode] = ruleChildren(node, "renderPair");
  if (pairNode !== undefined) {
    return visitRenderPair(pairNode, span);
  }
  const [identifierToken] = tokenChildren(node, "Identifier");
  if (identifierToken !== undefined) {
    return {
      kind: "identifier",
      name: decodeScoutQlIdentifier(identifierToken.image),
      span,
    };
  }
  const [keywordToken] = tokenChildren(node, "KeywordLike");
  if (keywordToken !== undefined) {
    return { kind: "identifier", name: keywordToken.image.toLowerCase(), span };
  }
  return { kind: "identifier", name: "", span };
}

function visitRenderPair(
  node: CstNode,
  fallback: ScoutQlSpan,
): ScoutQlRenderListItemAst {
  const span = cstSpan(node, fallback);
  const identifierTokens = tokenChildren(node, "Identifier");
  const [nameToken] = identifierTokens;
  if (nameToken === undefined) {
    return { kind: "identifier", name: "", span };
  }
  const name = decodeScoutQlIdentifier(nameToken.image);
  const valueToken = identifierTokens[1];
  if (valueToken !== undefined) {
    const valueSpan = tokenSpan(valueToken) ?? span;
    return {
      kind: "pair",
      name,
      value: {
        kind: "identifier",
        name: decodeScoutQlIdentifier(valueToken.image),
        span: valueSpan,
      },
      span,
    };
  }
  const [keywordValue] = tokenChildren(node, "KeywordLike");
  if (keywordValue !== undefined) {
    const valueSpan = tokenSpan(keywordValue) ?? span;
    return {
      kind: "pair",
      name,
      value: {
        kind: "identifier",
        name: keywordValue.image.toLowerCase(),
        span: valueSpan,
      },
      span,
    };
  }
  const [stringToken] = tokenChildren(node, "StringLiteral");
  if (stringToken !== undefined) {
    const valueSpan = tokenSpan(stringToken) ?? span;
    return {
      kind: "pair",
      name,
      value: {
        kind: "string",
        value: decodeScoutQlString(stringToken.image),
        span: valueSpan,
      },
      span,
    };
  }
  // Recovery lost the pair's value — degrade to a bare identifier item.
  return { kind: "identifier", name, span };
}

function visitRenderOption(
  node: CstNode,
  fallback: ScoutQlSpan,
): ScoutQlRenderOptionAst | null {
  const span = cstSpan(node, fallback);
  const [nameToken] = tokenChildren(node, "Identifier");
  const nameSpan = nameToken === undefined ? null : tokenSpan(nameToken);
  if (nameToken === undefined || nameSpan === null) {
    return null;
  }
  const [valueNode] = ruleChildren(node, "renderValue");
  const value: ScoutQlRenderValueAst =
    valueNode === undefined
      ? { kind: "identifier", name: "", span }
      : visitRenderValue(valueNode, span);
  return {
    name: decodeScoutQlIdentifier(nameToken.image),
    nameSpan,
    value,
    span,
  };
}

function visitSimpleClauses(
  root: CstNode,
  ast: ScoutQlQueryAst,
  state: VisitState,
): void {
  const querySpan = ast.span;
  const [selectNode] = ruleChildren(root, "selectClause");
  if (selectNode !== undefined) {
    const span = cstSpan(selectNode, querySpan);
    const items = ruleChildren(selectNode, "selectItem").map((item) =>
      visitSelectItem(item, state, span),
    );
    ast.select = { items, span };
  }
  const [fromNode] = ruleChildren(root, "fromClause");
  if (fromNode !== undefined) {
    const [sourceToken] = tokenChildren(fromNode, "Identifier");
    if (sourceToken !== undefined && tokenSpan(sourceToken) !== null) {
      ast.from = {
        source: decodeScoutQlIdentifier(sourceToken.image),
        span: cstSpan(fromNode, querySpan),
      };
    }
  }
  const [whereNode] = ruleChildren(root, "whereClause");
  if (whereNode !== undefined) {
    const span = cstSpan(whereNode, querySpan);
    const [exprNode] = ruleChildren(whereNode, "expr");
    ast.where = {
      expr:
        exprNode === undefined
          ? { kind: "error", span }
          : visitExpr(exprNode, 1, state, span),
      span,
    };
  }
  const [havingNode] = ruleChildren(root, "havingClause");
  if (havingNode !== undefined) {
    const span = cstSpan(havingNode, querySpan);
    const [exprNode] = ruleChildren(havingNode, "expr");
    ast.having = {
      expr:
        exprNode === undefined
          ? { kind: "error", span }
          : visitExpr(exprNode, 1, state, span),
      span,
    };
  }
}

function visitTailClauses(
  root: CstNode,
  ast: ScoutQlQueryAst,
  state: VisitState,
): void {
  const querySpan = ast.span;
  const [groupNode] = ruleChildren(root, "groupByClause");
  if (groupNode !== undefined) {
    const span = cstSpan(groupNode, querySpan);
    const items = ruleChildren(groupNode, "groupingItem").flatMap((item) => {
      const itemSpan = cstSpan(item, span);
      const [exprNode] = ruleChildren(item, "expr");
      return exprNode === undefined
        ? []
        : [visitExpr(exprNode, 1, state, itemSpan)];
    });
    ast.groupBy = { all: hasChild(groupNode, "All"), items, span };
  }
  const [orderNode] = ruleChildren(root, "orderByClause");
  if (orderNode !== undefined) {
    const span = cstSpan(orderNode, querySpan);
    const keys = ruleChildren(orderNode, "orderKey").map((keyNode) => {
      const keySpan = cstSpan(keyNode, span);
      const [exprNode] = ruleChildren(keyNode, "expr");
      let direction: "asc" | "desc" | null = null;
      if (hasChild(keyNode, "Asc")) {
        direction = "asc";
      } else if (hasChild(keyNode, "Desc")) {
        direction = "desc";
      }
      return {
        expr:
          exprNode === undefined
            ? { kind: "error" as const, span: keySpan }
            : visitExpr(exprNode, 1, state, keySpan),
        direction,
        span: keySpan,
      };
    });
    ast.orderBy = { keys, span };
  }
  const [limitNode] = ruleChildren(root, "limitClause");
  if (limitNode !== undefined) {
    const [numberToken] = tokenChildren(limitNode, "NumberLiteral");
    if (numberToken !== undefined && tokenSpan(numberToken) !== null) {
      ast.limit = {
        value: Number(numberToken.image),
        span: cstSpan(limitNode, querySpan),
      };
    }
  }
  const [renderNode] = ruleChildren(root, "renderClause");
  if (renderNode !== undefined) {
    const span = cstSpan(renderNode, querySpan);
    const [kindToken] = tokenChildren(renderNode, "Identifier");
    if (kindToken !== undefined && tokenSpan(kindToken) !== null) {
      const options = ruleChildren(renderNode, "renderOption").flatMap(
        (optionNode) => {
          const option = visitRenderOption(optionNode, span);
          return option === null ? [] : [option];
        },
      );
      ast.render = {
        kind: decodeScoutQlIdentifier(kindToken.image),
        options,
        span,
      };
    }
  }
}

/**
 * Convert a (possibly recovered, possibly undefined) query CST into a partial
 * AST plus depth/size diagnostics. Never throws on partial input.
 */
export function scoutQlCstToAst(
  root: CstNode | undefined,
  text: string,
): { ast: ScoutQlQueryAst; diagnostics: ScoutQlDiagnostic[] } {
  const ast: ScoutQlQueryAst = { span: { start: 0, end: text.length } };
  const state = newVisitState();
  if (root !== undefined) {
    visitSimpleClauses(root, ast, state);
    visitTailClauses(root, ast, state);
  }
  return { ast, diagnostics: state.diagnostics };
}
