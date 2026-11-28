import type { GolinkRouter } from "#server/trpc-router.ts";

/**
 * The tRPC router's type, for the browser and for typed callers
 * (`createConsoleClient<AppRouter>`). A type-only import: no server code
 * crosses into the client bundle.
 */
export type AppRouter = GolinkRouter & { readonly __wireContract?: never };
