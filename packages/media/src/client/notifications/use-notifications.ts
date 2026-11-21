import { useQuery } from "@tanstack/react-query";
import { NotificationListSchema } from "#shared/api.ts";
import { readApi } from "#client/api.ts";

/** What the notifications read is cached under, and invalidated by. */
export const NOTIFICATIONS_KEY = ["notifications"] as const;

/** How often the list is asked for again while a page is open. */
const REFRESH_MS = 30_000;

/**
 * The reader's notification deliveries. The page and the bell in the top
 * bar both read through here, so they share one request and one answer and
 * the number on the bell is the number the page shows.
 */
export function useNotifications() {
  return useQuery({
    queryKey: NOTIFICATIONS_KEY,
    queryFn: async () => readApi("/notifications", NotificationListSchema),
    refetchInterval: REFRESH_MS,
  });
}
