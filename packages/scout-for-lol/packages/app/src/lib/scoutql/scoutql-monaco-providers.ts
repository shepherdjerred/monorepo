import type * as Monaco from "monaco-editor";
import { match } from "ts-pattern";
import type {
  ScoutQlDiagnostic,
  ScoutQlFix,
  ScoutQlSeverity,
} from "@scout-for-lol/data/model/scoutql/diagnostics.ts";
import type { ScoutQlCompletionKind } from "@scout-for-lol/data/model/scoutql/complete-items.ts";
import { completeScoutQl } from "@scout-for-lol/data/model/scoutql/complete.ts";
import { formatScoutQl } from "@scout-for-lol/data/model/scoutql/format.ts";
import { hoverScoutQl } from "@scout-for-lol/data/model/scoutql/hover.ts";
import { lintScoutQl } from "@scout-for-lol/data/model/scoutql/lint.ts";
import { scoutQlSemanticTokens } from "@scout-for-lol/data/model/scoutql/semantic-tokens.ts";
import { signatureHelpScoutQl } from "@scout-for-lol/data/model/scoutql/signature.ts";
import { SCOUTQL_LANGUAGE_ID } from "#src/lib/scoutql/scoutql-monaco-language.ts";
import {
  encodeScoutQlSemanticTokens,
  SCOUTQL_SEMANTIC_TOKEN_MODIFIERS,
  SCOUTQL_SEMANTIC_TOKEN_TYPES,
} from "#src/lib/scoutql/scoutql-monaco-tokens.ts";

// ── Monaco ↔ ScoutQL language services ───────────────────────────────────────
// Every provider here is a thin adapter over an editor-agnostic pure function
// in `@scout-for-lol/data`. Nothing in this file decides what ScoutQL means —
// it only translates offsets to positions and enum to enum. That is the point
// of the split: the language is testable without an editor, and the docs site
// and the AI tools get the same answers the editor shows.
//
// All of it runs on the main thread. `monaco-setup.ts` bundles the base editor
// worker only, and none of these providers needs another one.

const MARKER_OWNER = "scoutql";

/** Nothing to release: every provider answers straight from a pure function. */
function noop(): void {
  // Intentionally empty.
}

/**
 * Diagnostics for the model whose markers were most recently set.
 *
 * Monaco's `IMarkerData` has no payload slot, so a quick fix cannot ride along
 * on the marker itself. The code-action provider is handed markers and has to
 * find its way back to the `ScoutQlDiagnostic` that produced them — hence this
 * cache, keyed by the model so it cannot outlive the document (a `Map` on the
 * URI string would need explicit dispose bookkeeping to avoid leaking every
 * model the app ever opened).
 */
const diagnosticsByModel = new WeakMap<
  Monaco.editor.ITextModel,
  ScoutQlDiagnostic[]
>();

/** The identity a marker and its diagnostic share. */
export type ScoutQlMarkerKey = {
  startOffset: number;
  endOffset: number;
  message: string;
};

/**
 * Finds the fixes for a marker by matching span and message.
 *
 * Span alone is not enough — a single span can carry two diagnostics (an
 * unknown column that is also not grouped) with different fixes — and message
 * alone is not enough either, because the same message repeats at every
 * offending offset. Together they are the identity Monaco round-trips.
 */
export function scoutQlFixesForMarker(
  diagnostics: readonly ScoutQlDiagnostic[],
  marker: ScoutQlMarkerKey,
): ScoutQlFix[] {
  return diagnostics.flatMap((diagnostic) =>
    diagnostic.span.start === marker.startOffset &&
    diagnostic.span.end === marker.endOffset &&
    diagnostic.message === marker.message
      ? (diagnostic.fixes ?? [])
      : [],
  );
}

function markerSeverity(
  monaco: typeof Monaco,
  severity: ScoutQlSeverity,
): Monaco.MarkerSeverity {
  return match(severity)
    .with("error", () => monaco.MarkerSeverity.Error)
    .with("warning", () => monaco.MarkerSeverity.Warning)
    .with("info", () => monaco.MarkerSeverity.Info)
    .exhaustive();
}

function spanRange(
  model: Monaco.editor.ITextModel,
  span: { start: number; end: number },
): Monaco.IRange {
  const start = model.getPositionAt(span.start);
  const end = model.getPositionAt(span.end);
  return {
    startLineNumber: start.lineNumber,
    startColumn: start.column,
    endLineNumber: end.lineNumber,
    endColumn: end.column,
  };
}

/**
 * Re-lints a model and publishes the result as markers, caching the
 * diagnostics so the code-action provider can recover their quick fixes.
 */
export function updateScoutQlDiagnostics(
  monaco: typeof Monaco,
  model: Monaco.editor.ITextModel,
): void {
  const diagnostics = lintScoutQl(model.getValue());
  diagnosticsByModel.set(model, diagnostics);
  monaco.editor.setModelMarkers(
    model,
    MARKER_OWNER,
    diagnostics.map((diagnostic) => ({
      message: diagnostic.message,
      code: diagnostic.code,
      severity: markerSeverity(monaco, diagnostic.severity),
      ...spanRange(model, diagnostic.span),
    })),
  );
}

// ── Providers ────────────────────────────────────────────────────────────────

function semanticTokensProvider(): Monaco.languages.DocumentSemanticTokensProvider {
  return {
    getLegend: () => ({
      tokenTypes: [...SCOUTQL_SEMANTIC_TOKEN_TYPES],
      tokenModifiers: [...SCOUTQL_SEMANTIC_TOKEN_MODIFIERS],
    }),
    provideDocumentSemanticTokens: (model) => {
      const text = model.getValue();
      return {
        data: Uint32Array.from(
          encodeScoutQlSemanticTokens(text, scoutQlSemanticTokens(text)),
        ),
      };
    },
    releaseDocumentSemanticTokens: noop,
  };
}

function completionKind(
  monaco: typeof Monaco,
  kind: ScoutQlCompletionKind,
): Monaco.languages.CompletionItemKind {
  const kinds = monaco.languages.CompletionItemKind;
  return match(kind)
    .with("keyword", () => kinds.Keyword)
    .with("source", () => kinds.Class)
    .with("column", () => kinds.Field)
    .with("function", () => kinds.Function)
    .with("aggregate", () => kinds.Method)
    .with("alias", () => kinds.Variable)
    .with("snippet", () => kinds.Snippet)
    .with("value", () => kinds.EnumMember)
    .with("render-kind", () => kinds.Enum)
    .with("render-option", () => kinds.Property)
    .exhaustive();
}

function completionProvider(
  monaco: typeof Monaco,
): Monaco.languages.CompletionItemProvider {
  return {
    triggerCharacters: [" ", ",", "(", "."],
    provideCompletionItems: (model, position) => {
      const word = model.getWordUntilPosition(position);
      const range: Monaco.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      const suggestions = completeScoutQl(
        model.getValue(),
        model.getOffsetAt(position),
      ).map((item) => ({
        label: item.label,
        kind: completionKind(monaco, item.kind),
        insertText: item.insertText,
        detail: item.detail,
        // `sortGroup` is a small integer band; prefixing it makes Monaco's
        // lexical sort agree with the language service's ranking.
        sortText: `${String(item.sortGroup)}${item.label}`,
        ...(item.insertTextFormat === "snippet"
          ? {
              insertTextRules:
                monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            }
          : {}),
        range,
      }));
      return { suggestions };
    },
  };
}

function signatureHelpProvider(): Monaco.languages.SignatureHelpProvider {
  return {
    signatureHelpTriggerCharacters: ["("],
    signatureHelpRetriggerCharacters: [","],
    provideSignatureHelp: (model, position) => {
      const help = signatureHelpScoutQl(
        model.getValue(),
        model.getOffsetAt(position),
      );
      if (help === undefined) {
        return null;
      }
      return {
        value: {
          signatures: help.signatures.map((signature) => ({
            label: signature.label,
            documentation: { value: signature.documentation },
            parameters: signature.parameters.map((parameter) => ({
              label: parameter.label,
              documentation: { value: parameter.documentation },
            })),
          })),
          activeSignature: help.activeSignature,
          activeParameter: help.activeParameter,
        },
        dispose: noop,
      };
    },
  };
}

function hoverProvider(): Monaco.languages.HoverProvider {
  return {
    provideHover: (model, position) => {
      const hover = hoverScoutQl(model.getValue(), model.getOffsetAt(position));
      if (hover === undefined) {
        return null;
      }
      return {
        contents: [{ value: hover.markdown }],
        range: spanRange(model, hover.span),
      };
    },
  };
}

function formattingProvider(): Monaco.languages.DocumentFormattingEditProvider {
  return {
    provideDocumentFormattingEdits: (model) => {
      const current = model.getValue();
      const formatted = formatScoutQl(current);
      // `formatScoutQl` returns the input unchanged when the query has error
      // diagnostics, so "no edits" is the normal answer for a half-typed query
      // rather than a failure.
      if (formatted === current) {
        return [];
      }
      return [{ range: model.getFullModelRange(), text: formatted }];
    },
  };
}

function fixAction(
  model: Monaco.editor.ITextModel,
  marker: Monaco.editor.IMarkerData,
  fix: ScoutQlFix,
): Monaco.languages.CodeAction {
  return {
    title: fix.title,
    kind: "quickfix",
    diagnostics: [marker],
    isPreferred: true,
    edit: {
      edits: fix.edits.map((edit) => ({
        resource: model.uri,
        versionId: model.getVersionId(),
        textEdit: { range: spanRange(model, edit), text: edit.newText },
      })),
    },
  };
}

function codeActionProvider(): Monaco.languages.CodeActionProvider {
  return {
    provideCodeActions: (model, _range, context) => {
      const diagnostics = diagnosticsByModel.get(model) ?? [];
      const actions = context.markers.flatMap((marker) =>
        scoutQlFixesForMarker(diagnostics, {
          startOffset: model.getOffsetAt({
            lineNumber: marker.startLineNumber,
            column: marker.startColumn,
          }),
          endOffset: model.getOffsetAt({
            lineNumber: marker.endLineNumber,
            column: marker.endColumn,
          }),
          message: marker.message,
        }).map((fix) => fixAction(model, marker, fix)),
      );
      return { actions, dispose: noop };
    },
  };
}

const registeredWith = new WeakSet<object>();

/**
 * Registers every ScoutQL language service with a Monaco instance. Idempotent
 * — Monaco keeps a list per language, so registering twice would double every
 * completion item and show each hover twice.
 */
export function registerScoutQlProviders(monaco: typeof Monaco): void {
  if (registeredWith.has(monaco)) {
    return;
  }
  registeredWith.add(monaco);
  const id = SCOUTQL_LANGUAGE_ID;
  monaco.languages.registerDocumentSemanticTokensProvider(
    id,
    semanticTokensProvider(),
  );
  monaco.languages.registerCompletionItemProvider(
    id,
    completionProvider(monaco),
  );
  monaco.languages.registerSignatureHelpProvider(id, signatureHelpProvider());
  monaco.languages.registerHoverProvider(id, hoverProvider());
  monaco.languages.registerDocumentFormattingEditProvider(
    id,
    formattingProvider(),
  );
  monaco.languages.registerCodeActionProvider(id, codeActionProvider());
}
