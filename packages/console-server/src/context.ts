import type { Context } from "hono";
import { z } from "zod";
import type { ConsoleIdentity } from "./identity.ts";

/** What `start()` passes to every request as Hono's `c.env`. */
export type ConsoleBindings = {
  readonly peerAddress: string | null;
};

export type ConsoleVariables = {
  readonly requestId: string;
  /** Resolves the caller once per request, on first use. */
  readonly identity: () => Promise<ConsoleIdentity>;
  /** Overrides the metric `route` label (`static`, `spa`). */
  readonly routeLabel: string | undefined;
};

export type ConsoleEnv = {
  Bindings: ConsoleBindings;
  Variables: ConsoleVariables;
};

const PeerBindingsSchema = z.object({ peerAddress: z.string().nullable() });

/**
 * The TCP peer `start()` recorded. `app.request()` in tests passes no
 * bindings unless it sets `{ peerAddress }` as the third argument.
 */
export function peerAddressOf(c: Context<ConsoleEnv>): string | null {
  const env: unknown = c.env;
  return PeerBindingsSchema.safeParse(env).data?.peerAddress ?? null;
}

/** The request's identity, resolved once and shared by REST and tRPC. */
export async function identityOf(
  c: Context<ConsoleEnv>,
): Promise<ConsoleIdentity> {
  return c.var.identity();
}

/** `x-request-id` from the caller, or a new UUID. */
export function requestIdOf(c: Context<ConsoleEnv>): string {
  return c.var.requestId;
}
