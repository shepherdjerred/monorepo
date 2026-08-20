import { stat } from "node:fs/promises";
import { makeHistoryDocument } from "./messages.ts";
import { firstText } from "./sources-shared.ts";
import {
  cleanText,
  extractText,
  parseJsonLine,
  parseRecord,
  parseTimestamp,
  stringValue,
} from "./text.ts";
import type { HistoryDocument, HistoryMessage } from "./types.ts";

function sourceId(filePath: string, lineNumber: number): string {
  return `${filePath}:line:${String(lineNumber)}`;
}

function promptFromLine(line: string): {
  readonly text: string;
  readonly timestamp: unknown;
  readonly runtimeId: string | null;
} | null {
  const value = parseJsonLine(line);
  const record = parseRecord(value);
  if (record === null) {
    return null;
  }
  const text = cleanText(
    extractText(record["prompt"] ?? record["text"] ?? record["content"]),
  );
  if (text.length === 0) {
    return null;
  }
  return {
    text,
    timestamp:
      record["timestamp"] ??
      record["created_at"] ??
      record["time"] ??
      record["ts"],
    runtimeId:
      stringValue(record["session_id"]) ??
      stringValue(record["sessionId"]) ??
      stringValue(record["thread_id"]) ??
      stringValue(record["threadId"]),
  };
}

export async function scanCodexHistoryJsonl(
  filePath: string,
): Promise<HistoryDocument[]> {
  const raw = await Bun.file(filePath).text();
  const info = await stat(filePath);
  return raw
    .split("\n")
    .map((line, index) => ({ line: line.trim(), index }))
    .filter((entry) => entry.line.length > 0)
    .flatMap((entry) => {
      const prompt = promptFromLine(entry.line);
      if (prompt === null) {
        return [];
      }
      const updatedAt = parseTimestamp(
        prompt.timestamp,
        new Date(info.mtimeMs),
      );
      const id = sourceId(filePath, entry.index + 1);
      return [
        makeHistoryDocument(
          {
            source: "codex",
            sourceId: id,
            title: firstText(prompt.text, "Codex history entry"),
            path: filePath,
            workspace: null,
            agent: "Codex",
            createdAt: updatedAt,
            updatedAt,
            runtimeId: prompt.runtimeId,
          },
          prompt.text.length === 0
            ? []
            : [{ role: "user", text: prompt.text, createdAt: updatedAt }],
        ),
      ];
    });
}

export async function readCodexHistoryJsonl(
  filePath: string,
  selectedSourceIds: ReadonlySet<string>,
): Promise<ReadonlyMap<string, readonly HistoryMessage[]>> {
  const prefix = `${filePath}:line:`;
  const selectedLines = new Set(
    [...selectedSourceIds].flatMap((id) => {
      if (!id.startsWith(prefix)) {
        return [];
      }
      const line = Number.parseInt(id.slice(prefix.length), 10);
      return Number.isInteger(line) && line > 0 ? [line] : [];
    }),
  );
  if (selectedLines.size === 0) {
    return new Map();
  }

  const info = await stat(filePath);
  const latestSelectedLine = Math.max(...selectedLines);
  const messages = new Map<string, readonly HistoryMessage[]>();
  const reader = Bun.file(filePath).stream().getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  let lineNumber = 0;
  let done = false;
  while (!done && lineNumber < latestSelectedLine) {
    const chunk = await reader.read();
    done = chunk.done;
    buffered += decoder.decode(chunk.value, { stream: !done });
    let newline = buffered.indexOf("\n");
    while (newline !== -1) {
      lineNumber += 1;
      const line = buffered.slice(0, newline).trim();
      buffered = buffered.slice(newline + 1);
      if (selectedLines.has(lineNumber) && line.length > 0) {
        const prompt = promptFromLine(line);
        if (prompt !== null) {
          const createdAt = parseTimestamp(
            prompt.timestamp,
            new Date(info.mtimeMs),
          );
          messages.set(sourceId(filePath, lineNumber), [
            { role: "user", text: prompt.text, createdAt },
          ]);
        }
      }
      if (lineNumber >= latestSelectedLine) {
        break;
      }
      newline = buffered.indexOf("\n");
    }
  }
  if (
    lineNumber < latestSelectedLine &&
    buffered.trim().length > 0 &&
    selectedLines.has(lineNumber + 1)
  ) {
    const finalLine = lineNumber + 1;
    const prompt = promptFromLine(buffered.trim());
    if (prompt !== null) {
      const createdAt = parseTimestamp(
        prompt.timestamp,
        new Date(info.mtimeMs),
      );
      messages.set(sourceId(filePath, finalLine), [
        { role: "user", text: prompt.text, createdAt },
      ]);
    }
  }
  await reader.cancel();
  return messages;
}
