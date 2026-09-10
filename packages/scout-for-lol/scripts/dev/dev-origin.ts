export function parseDevOrigin(value: string, name: string): string {
  let origin: URL;
  try {
    origin = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute http:// or https:// origin`);
  }
  if (
    (origin.protocol !== "http:" && origin.protocol !== "https:") ||
    origin.pathname !== "/" ||
    origin.search.length > 0 ||
    origin.hash.length > 0
  ) {
    throw new Error(`${name} must be an absolute http:// or https:// origin`);
  }
  return origin.origin;
}
