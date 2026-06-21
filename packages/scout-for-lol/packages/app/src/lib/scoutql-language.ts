import type * as Monaco from "monaco-editor";
import { match } from "ts-pattern";
import {
  completeReportQuery,
  lintReportQuery,
  REPORT_GROUP_BYS,
  REPORT_KEYWORDS,
  REPORT_METRICS,
  REPORT_SOURCES,
  reportQueueValues,
  type ReportCompletionKind,
  type ReportDiagnosticSeverity,
} from "@scout-for-lol/data";

export const SCOUTQL_LANGUAGE_ID = "scoutql";
const MARKER_OWNER = "scoutql";

let registered = false;

// Registers the scoutql language once: Monarch coloring + parser-driven
// completion and hover. Diagnostics are pushed per-model via
// updateScoutQlDiagnostics (called on change).
export function registerScoutQlLanguage(monaco: typeof Monaco): void {
  if (registered) {
    return;
  }
  registered = true;

  monaco.languages.register({ id: SCOUTQL_LANGUAGE_ID });
  monaco.languages.setMonarchTokensProvider(
    SCOUTQL_LANGUAGE_ID,
    monarchLanguage(),
  );
  monaco.languages.registerCompletionItemProvider(SCOUTQL_LANGUAGE_ID, {
    triggerCharacters: [" ", ",", "(", "."],
    provideCompletionItems: (model, position) =>
      provideCompletions(monaco, model, position),
  });
  monaco.languages.registerHoverProvider(SCOUTQL_LANGUAGE_ID, {
    provideHover: (model, position) => provideHover(model, position),
  });
}

export function updateScoutQlDiagnostics(
  monaco: typeof Monaco,
  model: Monaco.editor.ITextModel,
): void {
  const markers = lintReportQuery(model.getValue()).map((diagnostic) => {
    const start = model.getPositionAt(diagnostic.span.start);
    const end = model.getPositionAt(diagnostic.span.end);
    return {
      message: diagnostic.message,
      severity: markerSeverity(monaco, diagnostic.severity),
      startLineNumber: start.lineNumber,
      startColumn: start.column,
      endLineNumber: end.lineNumber,
      endColumn: end.column,
    };
  });
  monaco.editor.setModelMarkers(model, MARKER_OWNER, markers);
}

function provideCompletions(
  monaco: typeof Monaco,
  model: Monaco.editor.ITextModel,
  position: Monaco.Position,
): Monaco.languages.CompletionList {
  const offset = model.getOffsetAt(position);
  const word = model.getWordUntilPosition(position);
  const range: Monaco.IRange = {
    startLineNumber: position.lineNumber,
    endLineNumber: position.lineNumber,
    startColumn: word.startColumn,
    endColumn: word.endColumn,
  };
  const suggestions = completeReportQuery(model.getValue(), offset).map(
    (item) => ({
      label: item.label,
      kind: completionKind(monaco, item.kind),
      insertText: item.insertText,
      detail: item.detail,
      range,
    }),
  );
  return { suggestions };
}

function provideHover(
  model: Monaco.editor.ITextModel,
  position: Monaco.Position,
): Monaco.languages.Hover | null {
  const word = model.getWordAtPosition(position);
  if (word === null) {
    return null;
  }
  const doc = hoverDoc(word.word.toLowerCase());
  if (doc === undefined) {
    return null;
  }
  return { contents: [{ value: doc }] };
}

function hoverDoc(word: string): string | undefined {
  const source = REPORT_SOURCES.find((entry) => entry.id === word);
  if (source !== undefined) {
    return `**${source.label}** — source\n\n${source.description}`;
  }
  const metric = REPORT_METRICS.find((entry) => entry.id === word);
  if (metric !== undefined) {
    return `**${metric.label}** — metric\n\n${metric.description}`;
  }
  const field = REPORT_GROUP_BYS.find((entry) => entry.id === word);
  if (field !== undefined) {
    return `**${field.label}** — group by\n\n${field.description}`;
  }
  const keyword = REPORT_KEYWORDS.find(
    (entry) => entry.keyword.toLowerCase() === word,
  );
  if (keyword !== undefined) {
    return `**${keyword.keyword}** — keyword\n\n${keyword.description}`;
  }
  const queue = reportQueueValues().find((entry) => entry.id === word);
  if (queue !== undefined) {
    return `**${queue.label}** — queue value`;
  }
  return undefined;
}

function completionKind(
  monaco: typeof Monaco,
  kind: ReportCompletionKind,
): Monaco.languages.CompletionItemKind {
  return match(kind)
    .with("keyword", () => monaco.languages.CompletionItemKind.Keyword)
    .with("source", () => monaco.languages.CompletionItemKind.Class)
    .with("metric", () => monaco.languages.CompletionItemKind.Field)
    .with("field", () => monaco.languages.CompletionItemKind.Property)
    .with("queue", () => monaco.languages.CompletionItemKind.EnumMember)
    .exhaustive();
}

function markerSeverity(
  monaco: typeof Monaco,
  severity: ReportDiagnosticSeverity,
): Monaco.MarkerSeverity {
  return match(severity)
    .with("error", () => monaco.MarkerSeverity.Error)
    .with("warning", () => monaco.MarkerSeverity.Warning)
    .with("info", () => monaco.MarkerSeverity.Info)
    .exhaustive();
}

function monarchLanguage(): Monaco.languages.IMonarchLanguage {
  return {
    ignoreCase: true,
    keywords: [
      "select",
      "from",
      "where",
      "group",
      "by",
      "order",
      "limit",
      "and",
      "in",
      "asc",
      "desc",
    ],
    tokenizer: {
      root: [
        [
          /[a-z_]\w*/,
          { cases: { "@keywords": "keyword", "@default": "identifier" } },
        ],
        [/\d+/, "number"],
        [/'[^']*'|"[^"]*"/, "string"],
        [/>=|[=,()]/, "operator"],
        [/\s+/, "white"],
      ],
    },
  };
}
