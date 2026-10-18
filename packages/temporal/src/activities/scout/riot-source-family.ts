/**
 * The Riot-owned and League wiki hosts Scout's research guards accept as
 * authoritative. Season-refresh evidence and queue-window liveness checks both
 * use this allowlist; any other host is a lead, never proof.
 */
export function riotSourceFamily(url: string): "riot" | "wiki" | undefined {
  if (!URL.canParse(url)) return undefined;
  const host = new URL(url).hostname;
  if (host === "wiki.leagueoflegends.com") {
    return "wiki";
  }
  if (
    [
      "www.leagueoflegends.com",
      "leagueoflegends.com",
      "support-leagueoflegends.riotgames.com",
    ].includes(host)
  ) {
    return "riot";
  }
  return undefined;
}
