/** Stable destinations let markdown refer to attachments before their bytes are imported. */
export async function importId(
  source: string,
  entityType: string,
  externalId: string,
) {
  const bytes = new TextEncoder().encode(
    JSON.stringify([source, entityType, externalId]),
  );
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(hash), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
