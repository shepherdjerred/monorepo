// Exact source-label projection for original root HASH 0x1d369c29. The retained
// CDTB annotation names it objectPath; the archived annotator retains its hash.
export const DIRECT_SYSTEM_OBJECT_PATH_FIELD_HASH = "1d369c29";
export function canonicalDirectSystemObjectPath(source) {
  const field = `{${DIRECT_SYSTEM_OBJECT_PATH_FIELD_HASH}}`;
  if (
    source.__type !== "VfxSystemDefinitionData" ||
    !Object.hasOwn(source, field)
  )
    return source;
  if (Object.hasOwn(source, "objectPath"))
    throw Error("Duplicate original system objectPath field 1d369c29");
  const projected = { ...source, objectPath: source[field] };
  delete projected[field];
  return projected;
}
