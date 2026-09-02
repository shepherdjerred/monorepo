export type RelationalScoutQlJsonValue =
  | null
  | boolean
  | number
  | string
  | RelationalScoutQlJsonValue[]
  | { [key: string]: RelationalScoutQlJsonValue };

export function relationalScoutQlObjectValue(
  value: RelationalScoutQlJsonValue | undefined,
) {
  if (value === undefined || value === null || Array.isArray(value)) {
    return null;
  }
  return typeof value === "object" ? value : null;
}

export function relationalScoutQlStringValue(
  value: RelationalScoutQlJsonValue | undefined,
): string | null {
  return typeof value === "string" ? value : null;
}

export function relationalScoutQlArrayValue(
  value: RelationalScoutQlJsonValue | undefined,
): RelationalScoutQlJsonValue[] {
  return Array.isArray(value) ? value : [];
}
