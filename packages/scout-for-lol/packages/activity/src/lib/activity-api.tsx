import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { createTRPCContext } from "@trpc/tanstack-react-query";
import { useRef, useState, type ReactNode } from "react";
import type { AppRouter } from "@scout-for-lol/backend/trpc/router/index.ts";
import { useActivitySession } from "@/lib/activity-session";

export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>();

export function ActivityApiProvider({ children }: { children: ReactNode }) {
  const { auth } = useActivitySession();
  const activityToken = useRef(auth.activityToken);
  activityToken.current = auth.activityToken;
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 2, staleTime: 10_000 },
          mutations: { retry: 0 },
        },
      }),
  );
  const [trpcClient] = useState(() =>
    createTRPCClient<AppRouter>({
      links: [
        httpBatchLink({
          url: "/trpc",
          headers: () => ({
            Authorization: `Bearer ${activityToken.current}`,
          }),
        }),
      ],
    }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        {children}
      </TRPCProvider>
    </QueryClientProvider>
  );
}
