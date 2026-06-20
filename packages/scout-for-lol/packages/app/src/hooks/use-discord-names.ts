import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "#src/lib/trpc.ts";

type ResolvedName = {
  id: string;
  username: string;
  displayName: string;
  avatar: string | null;
};

/**
 * Batch-resolve a set of Discord IDs to display names via
 * `discord.resolveUsers`. Used where the domain payload doesn't already carry
 * resolved names (e.g. the audit log, whose actors aren't stored players).
 *
 * Returns a `resolve(id)` accessor; unresolved IDs yield `null` so callers can
 * fall back to the raw snowflake.
 */
export function useDiscordNames(ids: (string | null)[]): {
  resolve: (id: string | null) => ResolvedName | null;
} {
  const trpc = useTRPC();
  // Dedupe + drop nulls, sorted for a stable query key.
  const unique = [
    ...new Set(ids.flatMap((id) => (id === null ? [] : [id]))),
  ].toSorted();
  const query = useQuery(
    trpc.discord.resolveUsers.queryOptions(
      { ids: unique },
      { enabled: unique.length > 0 },
    ),
  );
  return {
    resolve: (id) => {
      if (id === null || query.data === undefined) return null;
      return query.data[id] ?? null;
    },
  };
}
