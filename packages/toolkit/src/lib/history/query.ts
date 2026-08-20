export type HistoryQueryPart = {
  readonly type: "phrase" | "prefix";
  readonly value: string;
};

export function normalizeSearchToken(value: string): string {
  return value
    .normalize("NFD")
    .replaceAll(/\p{M}+/gu, "")
    .toLocaleLowerCase();
}

export function searchTokens(text: string): string[] {
  return [...text.matchAll(/[\p{L}\p{N}]+/gu)]
    .map((match) => normalizeSearchToken(match[0]))
    .filter((word) => word.length > 0);
}

export function historyQueryParts(query: string): HistoryQueryPart[] {
  const parts: HistoryQueryPart[] = [];
  for (const match of query.matchAll(/"([^"]+)"|([^\s"]+)/gu)) {
    const phrase = searchTokens(match[1] ?? "");
    if (phrase.length > 0) {
      parts.push({ type: "phrase", value: phrase.join(" ") });
      continue;
    }
    for (const value of searchTokens(match[2] ?? "")) {
      parts.push({ type: "prefix", value });
    }
  }
  return parts;
}

export function queryPartIndex(
  tokens: readonly string[],
  part: HistoryQueryPart,
): number {
  if (part.type === "prefix") {
    return tokens.findIndex((token) => token.startsWith(part.value));
  }
  const phrase = part.value.split(" ");
  for (let index = 0; index <= tokens.length - phrase.length; index += 1) {
    if (phrase.every((value, offset) => tokens[index + offset] === value)) {
      return index;
    }
  }
  return -1;
}

export function ftsQuery(query: string): string {
  const clauses = historyQueryParts(query).map((part) =>
    part.type === "phrase"
      ? `"${part.value.replaceAll('"', '""')}"`
      : `"${part.value.replaceAll('"', '""')}"*`,
  );
  if (clauses.length === 0) {
    throw new Error("Search query must contain at least one letter or number");
  }
  return clauses.join(" AND ");
}

export function parseLimit(value: string | undefined): number {
  if (value === undefined) {
    return 20;
  }
  const limit = Number(value);
  const validSyntax = /^[1-9]\d*$/u.test(value);
  if (!validSyntax || !Number.isSafeInteger(limit) || limit > 200) {
    throw new RangeError("Limit must be an integer from 1 to 200");
  }
  return limit;
}

export function parseSince(
  value: string | undefined,
  now = new Date(),
): string | null {
  if (value === undefined) {
    return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  }
  const duration = /^(\d+)([hdw])$/u.exec(value.trim());
  if (duration !== null) {
    const amount = Number.parseInt(duration[1] ?? "", 10);
    const unit = duration[2];
    const multiplier = unit === "w" ? 7 : unit === "d" ? 1 : 1 / 24;
    return new Date(
      now.getTime() - amount * multiplier * 24 * 60 * 60 * 1000,
    ).toISOString();
  }
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    throw new TypeError(
      `Invalid --since value "${value}"; use 7d, 24h, 1w, or an ISO date`,
    );
  }
  return new Date(timestamp).toISOString();
}
