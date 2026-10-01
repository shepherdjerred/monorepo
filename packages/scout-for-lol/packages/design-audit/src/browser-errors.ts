/** Navigation intentionally probes this operator-only endpoint for visibility. */
export function isExpectedNavigationProbe(
  url: string,
  status: number,
): boolean {
  return (
    (status === 403 || status === 404) &&
    URL.canParse(url) &&
    new URL(url).pathname === "/trpc/operations.availability"
  );
}
