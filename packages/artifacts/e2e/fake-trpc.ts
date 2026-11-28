import { initTRPC } from "@trpc/server";

/**
 * The fake's own tRPC instance. The real one lives in `#server/rpc.ts` and
 * needs the database client; the fake serves the same procedure names and
 * schemas from memory, so the UI's `createTRPCClient<AppRouter>` cannot tell.
 */
export type FakeContext = {
  requestId: string;
  hostClass: "app" | "internal";
};

export const t = initTRPC.context<FakeContext>().create();
export const procedure = t.procedure;
