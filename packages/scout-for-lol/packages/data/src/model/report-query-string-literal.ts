export function parseReportStringLiteral(value: string): string {
  const quote = value.at(0);
  if (
    value.length < 2 ||
    (quote !== "'" && quote !== '"') ||
    value.at(-1) !== quote
  ) {
    throw new Error("Invalid ScoutQL string literal.");
  }
  return value
    .slice(1, -1)
    .replaceAll(/\\(["'\\])/gu, (_match, escaped: string) => escaped);
}
