import { stripVTControlCharacters } from "node:util";
import type {
  HistoryMessage,
  HistoryRecord,
  HistoryResult,
  HistoryWarning,
} from "./types.ts";

function terminalSafe(value: string): string {
  let result = "";
  for (const character of stripVTControlCharacters(value)) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint === 9 ||
      codePoint === 10 ||
      (codePoint !== undefined &&
        codePoint >= 32 &&
        (codePoint < 127 || codePoint > 159))
    ) {
      result += character;
    }
  }
  return result;
}

export function renderHistoryRecords(
  title: string,
  records: readonly HistoryResult[],
): string {
  const lines = [`## ${title}`, ""];
  if (records.length === 0) {
    lines.push("No matching history.");
    return lines.join("\n");
  }
  for (const record of records) {
    lines.push(
      `- **${record.title}** — ${record.source} — ${record.updatedAt} — ID ${String(record.id)}`,
    );
    if (record.workspace !== null) {
      lines.push(`  Workspace: \`${record.workspace}\``);
    }
    lines.push(`  Source: \`${record.path}\` (${record.sourceId})`);
    if (record.members.length > 1) {
      lines.push(`  Parallel sessions: ${String(record.members.length)}`);
      for (const member of record.members) {
        lines.push(
          `  - ID ${String(member.id)} — ${member.source} — ${member.createdAt} — ${member.title}`,
        );
      }
    }
    if (record.excerpt !== null && record.excerpt.length > 0) {
      lines.push(`  Excerpt: ${record.excerpt}`);
    }
  }
  return terminalSafe(lines.join("\n"));
}

export function renderHistoryShow(
  record: HistoryRecord,
  messages: readonly HistoryMessage[],
  truncated: boolean,
): string {
  const lines = [
    `## ${record.title}`,
    "",
    `ID: ${String(record.id)} · ${record.source} · ${record.updatedAt}`,
    "",
  ];
  for (const message of messages) {
    lines.push(
      `**${message.role}**${message.createdAt === null ? "" : ` · ${message.createdAt}`}`,
    );
    lines.push(message.text, "");
  }
  if (truncated) {
    lines.push(
      "_Context truncated. Increase --messages (maximum 50) for a wider bounded view._",
    );
  }
  return terminalSafe(lines.join("\n"));
}

export function printHistoryWarnings(
  warnings: readonly HistoryWarning[],
): void {
  for (const warning of warnings) {
    console.error(
      terminalSafe(`Warning [${warning.source}]: ${warning.message}`),
    );
  }
}
