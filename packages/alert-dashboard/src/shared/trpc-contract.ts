import type { AppRouter as ServerAppRouter } from "#server/trpc";

export type AppRouter = ServerAppRouter & { readonly __wireContract?: never };
