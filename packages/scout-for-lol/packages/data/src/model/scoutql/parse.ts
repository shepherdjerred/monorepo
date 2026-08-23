import type { CstNode, IRecognitionException, IToken } from "chevrotain";
import { REPORT_QUERY_MAX_LENGTH } from "#src/model/report.ts";
import type {
  ScoutQlDiagnostic,
  ScoutQlSpan,
} from "#src/model/scoutql/diagnostics.ts";
import type { ScoutQlQueryAst } from "#src/model/scoutql/ast.ts";
import { collapsedSpan } from "#src/model/scoutql/ast.ts";
import { scoutQlCstToAst } from "#src/model/scoutql/cst-to-ast.ts";
import { ScoutQlCstParser } from "#src/model/scoutql/parser.ts";
import {
  Case,
  LParen,
  Minus,
  Not,
  QuotedIdentifier,
  RParen,
  UnterminatedQuotedIdentifier,
  UnterminatedStringLiteral,
  tokenSpan,
  tokenizeScoutQl,
} from "#src/model/scoutql/tokens.ts";

// ── parseScoutQl — the one fault-tolerant parse ──────────────────────────────
// NEVER throws. Always returns a (possibly partial) AST plus positioned
// diagnostics; "strict" is a post-condition applied by compileScoutQl, which
// refuses on any error-severity diagnostic. The parser instance is a stateful
// but reusable module-level singleton (`parser.input = tokens` resets it).

export type ScoutQlParseResult = {
  /** Partial-tolerant AST — clauses a broken parse could not produce are absent. */
  ast: ScoutQlQueryAst;
  /** Full main token stream (for semantic tokens / the formatter). */
  tokens: IToken[];
  /** The `--` comment group, in source order. */
  comments: IToken[];
  diagnostics: ScoutQlDiagnostic[];
};

// Structural guards run over raw tokens BEFORE the recursive-descent parse, so
// pathological nesting cannot stack-overflow the parser itself. The visitor's
// depth cap (16) is the semantic bound; these only need to keep recursion sane.
const MAX_PAREN_NESTING = 32;
const MAX_PREFIX_RUN = 32;

const parser = new ScoutQlCstParser();

function sortDiagnostics(
  diagnostics: ScoutQlDiagnostic[],
): ScoutQlDiagnostic[] {
  return [...diagnostics].sort((a, b) => {
    if (a.span.start !== b.span.start) {
      return a.span.start - b.span.start;
    }
    if (a.span.end !== b.span.end) {
      return a.span.end - b.span.end;
    }
    return a.code.localeCompare(b.code);
  });
}

function tokenLevelDiagnostic(token: IToken): ScoutQlDiagnostic | null {
  const span = tokenSpan(token) ?? collapsedSpan(0);
  if (
    token.tokenType === QuotedIdentifier ||
    token.tokenType === UnterminatedQuotedIdentifier
  ) {
    return {
      code: "string-double-quoted",
      severity: "error",
      message:
        "ScoutQL strings use single quotes; \"…\" is an identifier in SQL. Write '…' instead.",
      span,
    };
  }
  if (token.tokenType === UnterminatedStringLiteral) {
    return {
      code: "lex-error",
      severity: "error",
      message: "Unterminated string literal — expected a closing '.",
      span,
    };
  }
  if (token.tokenType === Case) {
    return {
      code: "case-unsupported",
      severity: "error",
      message:
        "CASE is not supported in ScoutQL. Use FILTER (WHERE …) for conditional aggregates, or arithmetic bucketing (e.g. FLOOR(x / 300) * 300) for buckets.",
      span,
    };
  }
  return null;
}

/** First structural-pathology violation, or null when the stream is sane. */
function structuralGuardDiagnostic(tokens: IToken[]): ScoutQlDiagnostic | null {
  let parenDepth = 0;
  let prefixRun = 0;
  for (const token of tokens) {
    if (token.tokenType === LParen) {
      parenDepth += 1;
      if (parenDepth > MAX_PAREN_NESTING) {
        return {
          code: "expression-too-deep",
          severity: "error",
          message: `Parentheses nest deeper than the maximum of ${String(MAX_PAREN_NESTING)}.`,
          span: tokenSpan(token) ?? collapsedSpan(0),
        };
      }
    } else if (token.tokenType === RParen && parenDepth > 0) {
      parenDepth -= 1;
    }
    if (token.tokenType === Minus || token.tokenType === Not) {
      prefixRun += 1;
      if (prefixRun > MAX_PREFIX_RUN) {
        return {
          code: "expression-too-deep",
          severity: "error",
          message: `More than ${String(MAX_PREFIX_RUN)} consecutive prefix operators.`,
          span: tokenSpan(token) ?? collapsedSpan(0),
        };
      }
    } else {
      prefixRun = 0;
    }
  }
  return null;
}

function spansOverlap(a: ScoutQlSpan, b: ScoutQlSpan): boolean {
  return a.start < b.end && b.start < a.end;
}

function recognitionDiagnostics(
  errors: IRecognitionException[],
  textLength: number,
  caseSpans: ScoutQlSpan[],
): ScoutQlDiagnostic[] {
  const diagnostics: ScoutQlDiagnostic[] = [];
  for (const error of errors) {
    const span = tokenSpan(error.token) ?? collapsedSpan(textLength);
    // A parse error sitting on a CASE token is already covered by the targeted
    // "case-unsupported" diagnostic; the generic one would only add noise.
    if (caseSpans.some((caseSpan) => spansOverlap(span, caseSpan))) {
      continue;
    }
    diagnostics.push({
      code: "parse-error",
      severity: "error",
      message: error.message,
      span,
    });
  }
  return diagnostics;
}

function missingClauseDiagnostics(ast: ScoutQlQueryAst): ScoutQlDiagnostic[] {
  const diagnostics: ScoutQlDiagnostic[] = [];
  if (ast.select === undefined) {
    diagnostics.push({
      code: "parse-error",
      severity: "error",
      message: "Expected a SELECT clause.",
      span: collapsedSpan(ast.span.start),
    });
  }
  if (ast.from === undefined) {
    diagnostics.push({
      code: "parse-error",
      severity: "error",
      message: "Expected a FROM clause naming a source.",
      span: collapsedSpan(ast.select?.span.end ?? ast.span.start),
    });
  }
  return diagnostics;
}

export function parseScoutQl(text: string): ScoutQlParseResult {
  const querySpan: ScoutQlSpan = { start: 0, end: text.length };
  if (text.length > REPORT_QUERY_MAX_LENGTH) {
    return {
      ast: { span: querySpan },
      tokens: [],
      comments: [],
      diagnostics: [
        {
          code: "query-too-long",
          severity: "error",
          message: `Query is ${String(text.length)} characters; the maximum is ${String(REPORT_QUERY_MAX_LENGTH)}.`,
          span: querySpan,
        },
      ],
    };
  }
  const lex = tokenizeScoutQl(text);
  const diagnostics: ScoutQlDiagnostic[] = [];
  for (const error of lex.errors) {
    diagnostics.push({
      code: "lex-error",
      severity: "error",
      message: error.message,
      span: {
        start: error.offset,
        end: error.offset + Math.max(error.length, 1),
      },
    });
  }
  const caseSpans: ScoutQlSpan[] = [];
  for (const token of lex.tokens) {
    const diagnostic = tokenLevelDiagnostic(token);
    if (diagnostic !== null) {
      diagnostics.push(diagnostic);
      if (diagnostic.code === "case-unsupported") {
        caseSpans.push(diagnostic.span);
      }
    }
  }
  const guard = structuralGuardDiagnostic(lex.tokens);
  if (guard !== null) {
    diagnostics.push(guard);
    return {
      ast: { span: querySpan },
      tokens: lex.tokens,
      comments: lex.comments,
      diagnostics: sortDiagnostics(diagnostics),
    };
  }
  parser.input = lex.tokens;
  const cst: CstNode | undefined = parser.query();
  diagnostics.push(
    ...recognitionDiagnostics(parser.errors, text.length, caseSpans),
  );
  const visited = scoutQlCstToAst(cst, text);
  diagnostics.push(...visited.diagnostics);
  diagnostics.push(...missingClauseDiagnostics(visited.ast));
  return {
    ast: visited.ast,
    tokens: lex.tokens,
    comments: lex.comments,
    diagnostics: sortDiagnostics(diagnostics),
  };
}
