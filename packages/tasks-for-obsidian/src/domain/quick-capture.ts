import { CreateTaskRequestSchema } from "./base-schemas";
import type { CreateTaskRequest, NlpParseResult } from "./types";
import { PRIORITY_LABELS } from "./priority";
import { formatRelativeDate } from "../lib/dates";
import {
  parseTaskInput,
  projectNameFromInputToken,
  tokenizeTaskInput,
  type TaskInputToken,
} from "../lib/nlp";
import { recurrenceDisplayName } from "./quick-capture-recurrence";
import {
  createCaptureSeed,
  type CaptureLiteralSource,
  type CaptureSeed,
  type CaptureSeedField,
} from "./quick-capture-seed";
import {
  compareCaptureChips,
  deriveSeedChips,
  mergeProjects,
} from "./quick-capture-metadata";

export type CaptureChipKind =
  | "scheduled"
  | "deadline"
  | "recurrence"
  | "project"
  | "priority"
  | "context"
  | "tag";

type CaptureMetadataChipBase = {
  readonly id: string;
  readonly kind: CaptureChipKind;
  readonly label: string;
  readonly value: string;
};

export type CaptureParsedMetadataChip = CaptureMetadataChipBase & {
  readonly origin: "parsed";
  readonly source: CaptureLiteralSource;
};

export type CaptureSeedMetadataChip = CaptureMetadataChipBase & {
  readonly origin: "seed";
  readonly seedField: CaptureSeedField;
};

export type CaptureMetadataChip =
  | CaptureParsedMetadataChip
  | CaptureSeedMetadataChip;

export type CaptureDraft = {
  readonly input: string;
  readonly title: string;
  readonly parsed: NlpParseResult;
  readonly seed: CaptureSeed;
  readonly chips: readonly CaptureMetadataChip[];
};

type SourceSpan = {
  readonly sourceText: string;
  readonly occurrence: number;
  readonly start: number;
  readonly end: number;
};

type MaskedSource = SourceSpan & {
  readonly marker: string;
};

export function deriveCaptureDraft(
  input: string,
  literalSources: readonly CaptureLiteralSource[] = [],
  now = new Date(),
  seed: CaptureSeed = createCaptureSeed(),
): CaptureDraft {
  const masked = maskLiteralSources(input, literalSources);
  const parsedMasked = parseTaskInput(masked.input, now);
  const parsed: NlpParseResult = {
    ...parsedMasked,
    title: restoreLiteralSources(parsedMasked.title, masked.sources),
  };
  const protectedSpans = masked.sources.map((source) => ({
    start: source.start,
    end: source.end,
  }));

  const parsedChips = deriveMetadataChips(input, parsed, protectedSpans, now);
  const seedChips = deriveSeedChips(seed, parsed, now);

  return {
    input,
    title: parsed.title,
    parsed,
    seed,
    chips: [...seedChips, ...parsedChips].sort(compareCaptureChips),
  };
}

export function unparseCaptureChip(
  literalSources: readonly CaptureLiteralSource[],
  chip: CaptureParsedMetadataChip,
): readonly CaptureLiteralSource[] {
  const alreadyLiteral = literalSources.some(
    (source) =>
      source.sourceText === chip.source.sourceText &&
      source.occurrence === chip.source.occurrence,
  );
  return alreadyLiteral ? literalSources : [...literalSources, chip.source];
}

export function createCaptureRequest(draft: CaptureDraft): CreateTaskRequest {
  const projects = mergeProjects(draft.seed.project, draft.parsed.projects);
  const due = draft.parsed.due ?? draft.seed.due;
  const priority = draft.parsed.priority ?? draft.seed.priority;

  return CreateTaskRequestSchema.parse({
    title: draft.title.trim(),
    ...(draft.seed.scheduled === undefined
      ? {}
      : { scheduled: draft.seed.scheduled }),
    ...(due === undefined ? {} : { due }),
    ...(priority === undefined ? {} : { priority }),
    ...(projects.length === 0 ? {} : { projects }),
    ...(draft.parsed.contexts ? { contexts: draft.parsed.contexts } : {}),
    ...(draft.parsed.tags ? { tags: draft.parsed.tags } : {}),
    ...(draft.parsed.recurrence ? { recurrence: draft.parsed.recurrence } : {}),
  });
}

function deriveMetadataChips(
  input: string,
  parsed: NlpParseResult,
  protectedSpans: readonly { readonly start: number; readonly end: number }[],
  now: Date,
): readonly CaptureMetadataChip[] {
  const tokens = tokenizeTaskInput(input);
  const chips: CaptureMetadataChip[] = [];
  const activeTokens = tokens.filter(
    (token) => !overlapsAny(token.start, token.end, protectedSpans),
  );

  if (parsed.due) {
    const deadlineSpan = findDeadlineSpan(input, tokens, protectedSpans, now);
    if (deadlineSpan !== undefined) {
      chips.push(
        metadataChip(
          "deadline",
          parsed.due,
          `Deadline · ${formatRelativeDate(parsed.due, now)}`,
          deadlineSpan,
        ),
      );
    }
  }

  if (parsed.recurrence) {
    const recurrenceSpan = findRecurrenceSpan(
      input,
      tokens,
      protectedSpans,
      now,
    );
    if (recurrenceSpan !== undefined) {
      chips.push(
        metadataChip(
          "recurrence",
          parsed.recurrence,
          `Repeats · ${recurrenceDisplayName(parsed.recurrence)}`,
          recurrenceSpan,
        ),
      );
    }
  }

  for (const token of activeTokens) {
    const project = projectNameFromInputToken(token.text);
    if (project === undefined) continue;
    chips.push(
      metadataChip(
        "project",
        project,
        `Project · ${project}`,
        spanForToken(input, token),
      ),
    );
  }

  const priorityToken = activeTokens.findLast((token) => {
    const result = parseTaskInput(token.text, now);
    return result.priority !== undefined && result.title === "";
  });
  if (priorityToken && parsed.priority) {
    chips.push(
      metadataChip(
        "priority",
        parsed.priority,
        `Priority · ${PRIORITY_LABELS[parsed.priority]}`,
        spanForToken(input, priorityToken),
      ),
    );
  }

  for (const token of activeTokens) {
    if (token.text.startsWith("@") && token.text.length > 1) {
      const value = token.text.slice(1);
      chips.push(
        metadataChip(
          "context",
          value,
          `Context · ${value}`,
          spanForToken(input, token),
        ),
      );
    }
  }

  for (const token of activeTokens) {
    if (token.text.startsWith("#") && token.text.length > 1) {
      const value = token.text.slice(1);
      chips.push(
        metadataChip(
          "tag",
          value,
          `Tag · ${value}`,
          spanForToken(input, token),
        ),
      );
    }
  }

  return chips;
}

function findDeadlineSpan(
  input: string,
  tokens: readonly TaskInputToken[],
  protectedSpans: readonly { readonly start: number; readonly end: number }[],
  now: Date,
): SourceSpan | undefined {
  for (let startIndex = 0; startIndex < tokens.length; startIndex += 1) {
    for (const consumed of [3, 2, 1]) {
      const first = tokens[startIndex];
      const last = tokens[startIndex + consumed - 1];
      if (first === undefined || last === undefined) continue;
      if (overlapsAny(first.start, last.end, protectedSpans)) continue;

      const sourceText = input.slice(first.start, last.end);
      const candidate = parseTaskInput(sourceText, now);
      if (!isPureDeadline(candidate)) continue;
      return spanForSource(input, sourceText, first.start, last.end);
    }
  }
  return undefined;
}

function findRecurrenceSpan(
  input: string,
  tokens: readonly TaskInputToken[],
  protectedSpans: readonly { readonly start: number; readonly end: number }[],
  now: Date,
): SourceSpan | undefined {
  for (let startIndex = 0; startIndex < tokens.length; startIndex += 1) {
    const first = tokens[startIndex];
    const last = tokens[startIndex + 1];
    if (first === undefined || last === undefined) continue;
    if (overlapsAny(first.start, last.end, protectedSpans)) continue;

    const sourceText = input.slice(first.start, last.end);
    const candidate = parseTaskInput(sourceText, now);
    if (!isPureRecurrence(candidate)) continue;
    return spanForSource(input, sourceText, first.start, last.end);
  }
  return undefined;
}

function isPureDeadline(candidate: NlpParseResult): boolean {
  return (
    candidate.due !== undefined &&
    candidate.title === "" &&
    candidate.priority === undefined &&
    candidate.projects === undefined &&
    candidate.contexts === undefined &&
    candidate.tags === undefined &&
    candidate.recurrence === undefined
  );
}

function isPureRecurrence(candidate: NlpParseResult): boolean {
  return (
    candidate.recurrence !== undefined &&
    candidate.title === "" &&
    candidate.due === undefined &&
    candidate.priority === undefined &&
    candidate.projects === undefined &&
    candidate.contexts === undefined &&
    candidate.tags === undefined
  );
}

function metadataChip(
  kind: CaptureChipKind,
  value: string,
  label: string,
  source: SourceSpan,
): CaptureMetadataChip {
  return {
    id: `${kind}-${source.start}-${source.end}`,
    origin: "parsed",
    kind,
    label,
    value,
    source: {
      sourceText: source.sourceText,
      occurrence: source.occurrence,
    },
  };
}

function maskLiteralSources(
  input: string,
  literalSources: readonly CaptureLiteralSource[],
): { readonly input: string; readonly sources: readonly MaskedSource[] } {
  const resolved: MaskedSource[] = [];
  for (const [index, literal] of literalSources.entries()) {
    const source = findSourceSpans(input, literal.sourceText).find(
      (span) => span.occurrence === literal.occurrence,
    );
    if (source === undefined) continue;
    if (
      resolved.some((item) =>
        rangesOverlap(item.start, item.end, source.start, source.end),
      )
    ) {
      continue;
    }
    resolved.push({
      ...source,
      marker: `\u{E000}tasknotesliteral${index}\u{E001}`,
    });
  }

  let maskedInput = input;
  const descending = [...resolved].sort((a, b) => b.start - a.start);
  for (const source of descending) {
    maskedInput = `${maskedInput.slice(0, source.start)}${source.marker}${maskedInput.slice(source.end)}`;
  }
  return { input: maskedInput, sources: resolved };
}

function restoreLiteralSources(
  title: string,
  sources: readonly MaskedSource[],
): string {
  let restored = title;
  for (const source of sources) {
    restored = restored.replace(source.marker, source.sourceText);
  }
  return restored;
}

function spanForToken(input: string, token: TaskInputToken): SourceSpan {
  return spanForSource(input, token.text, token.start, token.end);
}

function spanForSource(
  input: string,
  sourceText: string,
  start: number,
  end: number,
): SourceSpan {
  const occurrence = findSourceSpans(input, sourceText).findIndex(
    (span) => span.start === start && span.end === end,
  );
  if (occurrence === -1) {
    throw new Error(`Capture source span not found: ${sourceText}`);
  }
  return { sourceText, occurrence, start, end };
}

function findSourceSpans(input: string, sourceText: string): SourceSpan[] {
  const inputTokens = tokenizeTaskInput(input);
  const sourceTokens = tokenizeTaskInput(sourceText);
  if (sourceTokens.length === 0) return [];

  const spans: SourceSpan[] = [];
  for (
    let startIndex = 0;
    startIndex + sourceTokens.length <= inputTokens.length;
    startIndex += 1
  ) {
    const matches = sourceTokens.every(
      (sourceToken, offset) =>
        inputTokens[startIndex + offset]?.text === sourceToken.text,
    );
    if (!matches) continue;
    const first = inputTokens[startIndex];
    const last = inputTokens[startIndex + sourceTokens.length - 1];
    if (first === undefined || last === undefined) {
      throw new Error("Capture source token bounds are invalid");
    }
    spans.push({
      sourceText: input.slice(first.start, last.end),
      occurrence: spans.length,
      start: first.start,
      end: last.end,
    });
  }
  return spans;
}

function overlapsAny(
  start: number,
  end: number,
  spans: readonly { readonly start: number; readonly end: number }[],
): boolean {
  return spans.some((span) => rangesOverlap(start, end, span.start, span.end));
}

function rangesOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}
