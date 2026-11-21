import { useSearchParams } from "react-router";
import { useRemote } from "@shepherdjerred/streambot/web/client/remote.tsx";
import { applyChanges } from "./query-params.ts";

/** The address-bar filters of a page, and a way to change some of them. */
export function useParamState() {
  const [params, setParams] = useSearchParams();
  return {
    params,
    update: (changes: Readonly<Record<string, string>>) => {
      setParams(applyChanges(params, changes));
    },
    /** The address that a change would lead to, for a link. */
    href: (changes: Readonly<Record<string, string>>) =>
      "?" + applyChanges(params, changes).toString(),
  };
}

/** The server to browse, or "" until the room is known. */
export function useBrowseGuild(): string {
  const remote = useRemote();
  return remote.room === null ? "" : remote.guildId;
}
