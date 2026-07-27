export function getPlainString(
  values: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = values[key];
  return typeof value === "string" ? value : undefined;
}

export function getBoolean(
  values: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const value = values[key];
  return typeof value === "boolean" ? value : undefined;
}
