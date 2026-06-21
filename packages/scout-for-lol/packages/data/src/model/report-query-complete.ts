import { match } from "ts-pattern";
import type { IToken, TokenType } from "chevrotain";
import {
  By,
  From,
  Group,
  In,
  Limit,
  LParen,
  Order,
  Render,
  RParen,
  Select,
  tokenizeReportQuery,
  tokenSpan,
  Where,
} from "#src/model/report-query-lexer.ts";
import {
  REPORT_FILTERS,
  REPORT_GROUP_BYS,
  REPORT_KEYWORDS,
  REPORT_METRICS,
  REPORT_RENDER_KINDS,
  REPORT_SOURCES,
  reportQueueValues,
} from "#src/model/report-query-registry.ts";

export type ReportCompletionKind =
  | "keyword"
  | "source"
  | "metric"
  | "field"
  | "queue";

export type ReportCompletionItem = {
  label: string;
  insertText: string;
  detail: string;
  kind: ReportCompletionKind;
};

type Region =
  | "start"
  | "select"
  | "source"
  | "where"
  | "queueValues"
  | "groupBy"
  | "orderBy"
  | "limit"
  | "render";

// Context-aware completions for the editor: combines grammar position (which
// clause the cursor sits in) with registry-driven identifier suggestions.
export function completeReportQuery(
  text: string,
  offset: number,
): ReportCompletionItem[] {
  const { tokens } = tokenizeReportQuery(text);
  return match(currentRegion(tokens, offset))
    .with("start", () => [keywordItem("SELECT")])
    .with("select", () => [...metricItems(), labelItem(), keywordItem("FROM")])
    .with("source", () => sourceItems())
    .with("where", () => whereStarterItems())
    .with("queueValues", () => queueItems())
    .with("groupBy", () => [...fieldItems(), keywordItem("RENDER")])
    .with("orderBy", () => [
      ...metricItems(),
      labelItem(),
      keywordItem("ASC"),
      keywordItem("DESC"),
      keywordItem("RENDER"),
    ])
    .with("limit", () => [keywordItem("RENDER")])
    .with("render", () => renderItems())
    .exhaustive();
}

function currentRegion(tokens: IToken[], offset: number): Region {
  if (insideQueueParens(tokens, offset)) {
    return "queueValues";
  }
  const candidates = [
    ["select", keywordEnd(tokens, Select)],
    ["source", keywordEnd(tokens, From)],
    ["where", keywordEnd(tokens, Where)],
    ["groupBy", twoWordKeywordEnd(tokens, Group)],
    ["orderBy", twoWordKeywordEnd(tokens, Order)],
    ["limit", keywordEnd(tokens, Limit)],
    ["render", keywordEnd(tokens, Render)],
  ] satisfies [Region, number][];

  const markers = candidates.filter(([, at]) => at !== -1 && at <= offset);
  if (markers.length === 0) {
    return "start";
  }
  return markers.reduce((best, marker) =>
    marker[1] >= best[1] ? marker : best,
  )[0];
}

function keywordEnd(tokens: IToken[], type: TokenType): number {
  const token = tokens.find((candidate) => candidate.tokenType === type);
  return token === undefined ? -1 : tokenSpan(token).end;
}

function twoWordKeywordEnd(tokens: IToken[], lead: TokenType): number {
  for (let index = 0; index < tokens.length - 1; index++) {
    if (
      tokens[index]?.tokenType === lead &&
      tokens[index + 1]?.tokenType === By
    ) {
      const by = tokens[index + 1];
      return by === undefined ? -1 : tokenSpan(by).end;
    }
  }
  return -1;
}

function insideQueueParens(tokens: IToken[], offset: number): boolean {
  let open = false;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token === undefined || token.startOffset >= offset) {
      break;
    }
    if (token.tokenType === LParen && tokens[index - 1]?.tokenType === In) {
      open = true;
    } else if (token.tokenType === RParen) {
      open = false;
    }
  }
  return open;
}

function metricItems(): ReportCompletionItem[] {
  return REPORT_METRICS.map((metric) => ({
    label: metric.id,
    insertText: metric.id,
    detail: metric.label,
    kind: "metric",
  }));
}

function sourceItems(): ReportCompletionItem[] {
  return REPORT_SOURCES.map((source) => ({
    label: source.id,
    insertText: source.id,
    detail: source.label,
    kind: "source",
  }));
}

function fieldItems(): ReportCompletionItem[] {
  return REPORT_GROUP_BYS.map((groupBy) => ({
    label: groupBy.id,
    insertText: groupBy.id,
    detail: groupBy.label,
    kind: "field",
  }));
}

function whereStarterItems(): ReportCompletionItem[] {
  return REPORT_FILTERS.map((filter) => ({
    label: filter.id,
    insertText: filter.id,
    detail: filter.syntax,
    kind: "field",
  }));
}

function queueItems(): ReportCompletionItem[] {
  return reportQueueValues().map((queue) => ({
    label: queue.id,
    insertText: queue.id,
    detail: queue.label,
    kind: "queue",
  }));
}

function renderItems(): ReportCompletionItem[] {
  const kinds: ReportCompletionItem[] = REPORT_RENDER_KINDS.map((kind) => ({
    label: kind.id,
    insertText: kind.id,
    detail: kind.description,
    kind: "keyword",
  }));
  return [...kinds, keywordItem("WITH")];
}

function labelItem(): ReportCompletionItem {
  return {
    label: "label",
    insertText: "label",
    detail: "Grouping column",
    kind: "field",
  };
}

function keywordItem(keyword: string): ReportCompletionItem {
  const info = REPORT_KEYWORDS.find((entry) => entry.keyword === keyword);
  return {
    label: keyword,
    insertText: keyword,
    detail: info?.description ?? "",
    kind: "keyword",
  };
}
