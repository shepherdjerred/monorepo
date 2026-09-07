import { useEffect } from "react";
import { clearGuildContext, resolveGuildContext } from "#src/lib/analytics.ts";

export function useGuildAnalyticsContext(input: {
  contextRoute: string | undefined;
  loading: boolean;
  guildId: string | undefined;
}): void {
  useEffect(() => {
    if (input.contextRoute === undefined || input.loading) return;
    resolveGuildContext(input.contextRoute, input.guildId);
    return () => {
      clearGuildContext();
    };
  }, [input.contextRoute, input.loading, input.guildId]);
}
