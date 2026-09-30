export function formatRiotId(
  account: { gameName: string | null; tagLine: string | null },
  fallback: string,
): string {
  if (account.gameName === null) return fallback;
  return account.tagLine === null
    ? account.gameName
    : `${account.gameName}#${account.tagLine}`;
}
