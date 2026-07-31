/**
 * Shared structured logger for the GitHub webhook server and its helpers
 * (`github-webhook.ts`, `pr-closed.ts`, `conflict-check-starts.ts`). Kept in
 * its own module so they can emit logs under the same component tag without a
 * circular import.
 */
export const COMPONENT = "pr-webhook";

export function jsonLog(
  level: "info" | "warning" | "error",
  message: string,
  fields: Record<string, unknown> = {},
): void {
  console.warn(
    JSON.stringify({
      level,
      msg: message,
      component: COMPONENT,
      ...fields,
    }),
  );
}
