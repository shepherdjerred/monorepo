import { cleanText, excerptForQuery } from "./text.ts";
import {
  historyQueryParts,
  queryPartIndex,
  searchTokens,
  type HistoryQueryPart,
} from "./query.ts";
import type { HistoryMessage } from "./types.ts";

const SHOW_CHARACTER_LIMIT = 6000;

function partMatches(
  tokens: readonly string[],
  part: HistoryQueryPart,
): boolean {
  return queryPartIndex(tokens, part) >= 0;
}

export function messageMatchesQuery(text: string, query: string): boolean {
  const tokens = searchTokens(cleanText(text));
  const parts = historyQueryParts(query);
  return parts.length > 0 && parts.every((part) => partMatches(tokens, part));
}

function matchScore(text: string, query: string): number {
  const tokens = searchTokens(cleanText(text));
  return historyQueryParts(query).reduce((score, part) => {
    const first = queryPartIndex(tokens, part);
    if (first === -1) {
      return score;
    }
    return score + (part.type === "phrase" ? 10 : 1) + 1 / (first + 1);
  }, 0);
}

function boundedMessages(
  messages: readonly HistoryMessage[],
  limit: number,
  query: string | null,
  priorityIndex: number | null = null,
): {
  readonly messages: readonly HistoryMessage[];
  readonly truncated: boolean;
} {
  const window = messages.slice(0, limit);
  const visitOrder =
    priorityIndex === null
      ? window.map((_, index) => index)
      : window
          .map((_, index) => index)
          .sort(
            (left, right) =>
              Math.abs(left - priorityIndex) -
                Math.abs(right - priorityIndex) || left - right,
          );
  const selected: { readonly index: number; readonly entry: HistoryMessage }[] =
    [];
  let characters = 0;
  let truncated = messages.length > limit;
  for (const [visitIndex, index] of visitOrder.entries()) {
    const entry = window[index];
    if (entry === undefined) {
      throw new Error(`History message ${String(index)} is missing`);
    }
    const remaining = SHOW_CHARACTER_LIMIT - characters;
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    const remainingEntries = visitOrder.length - visitIndex;
    const entryLimit = Math.max(1, Math.floor(remaining / remainingEntries));
    if (entry.text.length <= entryLimit) {
      selected.push({ index, entry });
      characters += entry.text.length;
      continue;
    }
    const text =
      query === null || !messageMatchesQuery(entry.text, query)
        ? `${entry.text.slice(0, Math.max(0, entryLimit - 1))}…`
        : excerptForQuery(entry.text, query, entryLimit);
    if (
      query === null ||
      entry.role !== "tool" ||
      messageMatchesQuery(text, query)
    ) {
      selected.push({ index, entry: { ...entry, text } });
      characters += text.length;
    }
    truncated = true;
  }
  return {
    messages: selected
      .sort((left, right) => left.index - right.index)
      .map(({ entry }) => entry),
    truncated,
  };
}

export function selectShowMessages(
  messages: readonly HistoryMessage[],
  options: {
    readonly query: string | null;
    readonly messageLimit: number;
    readonly includeTools: boolean;
  },
): {
  readonly messages: readonly HistoryMessage[];
  readonly truncated: boolean;
} {
  if (messages.length === 0) {
    return { messages: [], truncated: false };
  }
  if (options.query !== null) {
    const eligible = messages.filter(
      (entry) =>
        entry.role !== "tool" ||
        options.includeTools ||
        messageMatchesQuery(entry.text, options.query ?? ""),
    );
    const candidates = eligible.map((entry, index) => ({ entry, index }));
    const matchingDialogue = candidates.filter(
      ({ entry }) =>
        entry.role !== "tool" &&
        messageMatchesQuery(entry.text, options.query ?? ""),
    );
    const matchingTools = candidates.filter(
      ({ entry }) =>
        entry.role === "tool" &&
        messageMatchesQuery(entry.text, options.query ?? ""),
    );
    const partialDialogue = candidates.filter(
      ({ entry }) => entry.role !== "tool",
    );
    const centeringCandidates =
      matchingDialogue.length > 0
        ? matchingDialogue
        : matchingTools.length > 0
          ? matchingTools
          : partialDialogue;
    const best = centeringCandidates.reduce<{
      readonly index: number;
      readonly score: number;
    } | null>((current, candidate) => {
      const score = matchScore(candidate.entry.text, options.query ?? "");
      return current === null || score > current.score
        ? { index: candidate.index, score }
        : current;
    }, null);
    const center = best?.index ?? Math.max(0, eligible.length - 1);
    const start = Math.max(
      0,
      Math.min(
        center - Math.floor(options.messageLimit / 2),
        eligible.length - options.messageLimit,
      ),
    );
    const window = eligible.slice(start, start + options.messageLimit);
    const bounded = boundedMessages(
      window,
      options.messageLimit,
      options.query,
      center - start,
    );
    return {
      messages: bounded.messages,
      truncated:
        bounded.truncated ||
        eligible.length !== messages.length ||
        start > 0 ||
        start + window.length < eligible.length,
    };
  }

  const eligible = options.includeTools
    ? [...messages]
    : messages.filter((entry) => entry.role !== "tool");
  const openingIndex = eligible.findIndex((entry) => entry.role === "user");
  const opening = openingIndex === -1 ? null : (eligible[openingIndex] ?? null);
  const tailCount = Math.max(
    0,
    options.messageLimit - (opening === null ? 0 : 1),
  );
  const tail = eligible
    .filter((_, index) => index !== openingIndex)
    .slice(-tailCount);
  const selected =
    opening === null
      ? eligible.slice(-options.messageLimit)
      : [opening, ...tail];
  const bounded = boundedMessages(selected, options.messageLimit, null);
  return {
    messages: bounded.messages,
    truncated:
      bounded.truncated ||
      eligible.length !== messages.length ||
      selected.length < eligible.length,
  };
}

export function dialogueFirstExcerpt(
  messages: readonly HistoryMessage[],
  query: string,
): string {
  const dialogue = messages
    .filter((entry) => entry.role !== "tool")
    .map((entry) => entry.text)
    .join("\n");
  const tools = messages
    .filter((entry) => entry.role === "tool")
    .map((entry) => entry.text)
    .join("\n");
  return excerptForQuery(
    [dialogue, tools].filter((text) => text.length > 0).join("\n"),
    query,
  );
}

export function parseMessageLimit(value: string | undefined): number {
  if (value === undefined) {
    return 8;
  }
  const limit = Number(value);
  if (
    !/^[1-9]\d*$/u.test(value) ||
    !Number.isSafeInteger(limit) ||
    limit > 50
  ) {
    throw new RangeError("Messages must be an integer from 1 to 50");
  }
  return limit;
}
