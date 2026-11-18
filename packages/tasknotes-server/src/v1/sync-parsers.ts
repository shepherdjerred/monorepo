export function parseValidDate(raw: string): Date {
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError(`Invalid date value: ${raw}`);
  }
  return parsed;
}

export function resolveRequiredId(
  id: string,
  tempIdMapping: Record<string, string>,
): string {
  return id === "" ? "" : (tempIdMapping[id] ?? id);
}

export function resolveOptionalIdForCreate(
  id: string | null | undefined,
  tempIdMapping: Record<string, string>,
): string | undefined {
  return id === undefined || id === null || id === ""
    ? undefined
    : (tempIdMapping[id] ?? id);
}

export function resolveNullableIdForUpdate(
  id: string | null | undefined,
  tempIdMapping: Record<string, string>,
): string | null | undefined {
  if (id === undefined) {
    return undefined;
  }
  return id === null || id === "" ? null : (tempIdMapping[id] ?? id);
}

export function parseOptionalDateForCreate(
  raw: string | null | undefined,
): Date | undefined {
  return raw === undefined || raw === null || raw === ""
    ? undefined
    : parseValidDate(raw);
}

export function parseNullableDateForUpdate(
  raw: string | null | undefined,
): Date | null | undefined {
  if (raw === undefined) {
    return undefined;
  }
  return raw === null || raw === "" ? null : parseValidDate(raw);
}

export function parseNullableStringForUpdate(
  raw: string | null | undefined,
): string | null | undefined {
  if (raw === undefined) {
    return undefined;
  }
  return raw === null || raw === "" ? null : raw;
}

export function parseOptionalStringForCreate(
  raw: string | null | undefined,
): string | undefined {
  return raw === undefined || raw === null || raw === "" ? undefined : raw;
}

export function resolveLabelIds(
  labelIds: string[] | undefined,
  tempIdMapping: Record<string, string>,
): string[] | undefined {
  if (labelIds === undefined) {
    return undefined;
  }
  const resolved = labelIds
    .filter((id) => id !== "")
    .map((id) => tempIdMapping[id] ?? id);
  return [...new Set(resolved)];
}
