import { z } from "zod";

/**
 * Whether this browser may see the operations console, read off the server.
 *
 * There is no client-side flag read here, and there must not be one. The
 * console's visibility and its authorization are two different decisions made
 * in two different places, and only one of them is enforceable:
 *
 * - `scout_operations_console_enabled` controls VISIBILITY. It can only ever
 *   take the surface away, and hiding a link protects nothing — identical SPA
 *   bytes ship to every stage, and anyone can type the path.
 * - The Git-managed operator allowlist is the AUTHORIZATION, and it is checked
 *   server-side, first, with the flag in any state. Every procedure in the
 *   operations router is built from a gated procedure builder, so there is no
 *   request the console could make that skips it.
 *
 * That ordering is why this probe is honest rather than decorative. The server
 * answers FORBIDDEN before it ever looks at the flag, so a non-operator sees
 * `not-authorized` whether the console is rolled out or not — the console being
 * hidden never implies the viewer would otherwise have been let in, and nothing
 * this module returns should be presented as though the flag were protecting
 * anything.
 */

export type OperationsConsoleAccess =
  /** The probe has not answered yet. */
  | { readonly kind: "loading" }
  /** This session may operate the pipeline. */
  | { readonly kind: "open" }
  /** The rollout flag is off for this session, so the surface is not offered. */
  | { readonly kind: "hidden" }
  /** A real session that is not on the operator allowlist. */
  | { readonly kind: "not-authorized" }
  /** No web session at all. */
  | { readonly kind: "signed-out" }
  /** The probe failed for a reason that is not an answer. */
  | { readonly kind: "unreadable"; readonly message: string };

const TrpcErrorSchema = z.object({
  data: z.object({ code: z.string() }),
});

const ErrorMessageSchema = z.object({ message: z.string() });

/**
 * Read the probe.
 *
 * Data wins over an error: a refetch that fails after a successful answer must
 * not shut a working console, and react-query keeps both on the same result.
 */
export function resolveOperationsAccess(probe: {
  readonly hasData: boolean;
  readonly error: unknown;
}): OperationsConsoleAccess {
  if (probe.hasData) return { kind: "open" };
  if (probe.error === null || probe.error === undefined) {
    return { kind: "loading" };
  }
  const code = TrpcErrorSchema.safeParse(probe.error).data?.data.code;
  switch (code) {
    case "NOT_FOUND":
      return { kind: "hidden" };
    case "FORBIDDEN":
      return { kind: "not-authorized" };
    case "UNAUTHORIZED":
      return { kind: "signed-out" };
    // A thrown value with no tRPC code at all, and every code that is not one
    // of the three answers above: both are failures rather than verdicts.
    case undefined:
    default:
      return {
        kind: "unreadable",
        message:
          ErrorMessageSchema.safeParse(probe.error).data?.message ??
          "Scout could not check whether operations are available.",
      };
  }
}

/**
 * Whether the sidebar offers the console.
 *
 * Only an `open` answer puts the link up. Everything else — hidden, refused,
 * still loading, unreadable — leaves it off, so the sidebar never advertises a
 * surface the server would not serve.
 */
export function operationsNavVisible(access: OperationsConsoleAccess): boolean {
  return access.kind === "open";
}

/** What the route itself says when it will not show the console. */
export function operationsAccessNotice(access: OperationsConsoleAccess): {
  readonly title: string;
  readonly message: string;
} | null {
  switch (access.kind) {
    case "open":
    case "loading":
      return null;
    case "hidden":
      return {
        title: "Operations are unavailable",
        message: "The match operations console is not available here.",
      };
    case "not-authorized":
      return {
        title: "You are not a Scout operator",
        message:
          "Operating the durable match pipeline is limited to the Git-managed operator list. Nothing on this page would work for this account.",
      };
    case "signed-out":
      return {
        title: "Sign in to continue",
        message: "The operations console needs a Scout web session.",
      };
    case "unreadable":
      return {
        title: "Operations could not be checked",
        message: access.message,
      };
  }
}
