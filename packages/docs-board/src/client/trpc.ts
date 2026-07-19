import {
  createTRPCClient,
  httpBatchLink,
  httpSubscriptionLink,
  splitLink,
} from "@trpc/client";
import { createTRPCContext } from "@trpc/tanstack-react-query";

import type { AppRouter } from "#server/trpc";

export const trpcClient = createTRPCClient<AppRouter>({
  links: [
    splitLink({
      condition: (operation) => operation.type === "subscription",
      true: httpSubscriptionLink({ url: "/trpc" }),
      false: httpBatchLink({ url: "/trpc" }),
    }),
  ],
});

export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>();
