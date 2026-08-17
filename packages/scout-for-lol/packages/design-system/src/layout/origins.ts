/**
 * Build a link to another Scout surface without changing the normal
 * same-origin production/beta URL when no development origin is configured.
 */
export function surfaceHref(
  origin: string | undefined,
  pathname: string,
): string {
  if (origin === undefined || origin.length === 0) return pathname;
  return `${origin.replace(/\/$/, "")}${pathname}`;
}
