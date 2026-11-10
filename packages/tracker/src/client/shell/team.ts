import { useSearchParams } from "react-router";
import type { BootstrapData } from "#client/data/api.ts";

const lastTeamKey = "tracker.team";

/** Remember the team the user last chose so views without a `team` param keep it. */
export function rememberTeam(key: string) {
  localStorage.setItem(lastTeamKey, key);
}

/**
 * The team in view: the URL `team` param, else the last team the user chose,
 * else the first team. Undefined only while the workspace is still loading.
 */
export function useTeamKey(bootstrap: BootstrapData | undefined) {
  const [params] = useSearchParams();
  const fromUrl = params.get("team");
  if (fromUrl !== null) {
    return fromUrl;
  }
  if (bootstrap === undefined) {
    return;
  }
  const stored = localStorage.getItem(lastTeamKey);
  const team =
    bootstrap.teams.find(({ key }) => key === stored) ?? bootstrap.teams[0];
  if (team === undefined) {
    throw new Error("Tracker has no teams");
  }
  return team.key;
}
