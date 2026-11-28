/** A typed tRPC client for specs and the seed, optionally speaking as an agent. */
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { ACTOR_HEADER, type Actor } from "#shared/contract.ts";
import type { AppRouter } from "#shared/contract.ts";

export function encodeActor(actor: Actor): string {
  return btoa(JSON.stringify(actor));
}

/** An agent identity the way `toolkit` would send it. */
export function agentActor(name: string, worktree = "/e2e/worktree"): Actor {
  return {
    key: `agent:${name.toLowerCase().replaceAll(/[^\da-z]+/gu, "-")}`,
    kind: "agent",
    name,
    metadata: { harness: "e2e", hostname: "e2e-host", worktree },
  };
}

export function createApiClient(appUrl: string, actor?: Actor) {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `${appUrl}/trpc`,
        headers:
          actor === undefined ? {} : { [ACTOR_HEADER]: encodeActor(actor) },
      }),
    ],
  });
}

export type ApiClient = ReturnType<typeof createApiClient>;
