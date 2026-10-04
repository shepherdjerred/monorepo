import { useLocation, useSearchParams } from "react-router";

export const PAGE_TITLES: Readonly<Record<string, string>> = {
  "/plex": "Plex",
  "/search": "Search & links",
  "/sports": "Live sports",
  "/history": "History",
};

export function useRouteState() {
  const [params, setParams] = useSearchParams();
  const { pathname } = useLocation();
  function values(changes: Record<string, string>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value === "") next.delete(key);
      else next.set(key, value);
    }
    return next;
  }
  return {
    params,
    update: (changes: Record<string, string>, replace = false) => {
      setParams(values(changes), { replace });
    },
    href: (changes: Record<string, string>) =>
      pathname + "?" + values(changes).toString(),
  };
}

export function pageOffset(value: string | null): number {
  return value !== null && /^\d{1,7}$/u.test(value) ? Number(value) : 0;
}

export function selectedGuildId(
  guilds: readonly { id: string }[],
  requested: string | null,
): string {
  return (
    guilds.find((guild) => guild.id === requested)?.id ?? guilds[0]?.id ?? ""
  );
}
