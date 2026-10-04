/** Navigation intentionally probes operator-only endpoints for visibility. */
export function isExpectedNavigationProbe(
  url: string,
  status: number,
): boolean {
  if ((status !== 403 && status !== 404) || !URL.canParse(url)) return false;
  const path = new URL(url).pathname;
  return (
    path.startsWith("/trpc/") &&
    path
      .slice("/trpc/".length)
      .split(",")
      .every(
        (procedure) =>
          procedure === "operations.availability" ||
          procedure === "operations.inbox.availability",
      )
  );
}
