import { trackerClient } from "./tracker/client.ts";
import { loadToolkitConfig } from "./toolkit-config.ts";

type Notice = Awaited<
  ReturnType<ReturnType<typeof trackerClient>["forum"]["list"]["query"]>
>["items"][number];
export type CoordinationSummary = {
  available: boolean;
  checkedAt: string;
  items: Pick<
    Notice,
    "id" | "title" | "scopes" | "exitCondition" | "expiresAt" | "creator"
  >[];
  total: number | null;
  error: string | null;
};

/** Advisory context only: bounded independently from CI/ops and never a gate. */
export async function coordinationSummary(
  requestedScopes?: string[],
  baseUrl?: string,
): Promise<CoordinationSummary> {
  const checkedAt = new Date().toISOString();
  try {
    const config = await loadToolkitConfig();
    const url = baseUrl ?? (await config.value("trackerUrl"));
    const result = await trackerClient(url, 3000).forum.list.query({
      kind: "notice",
      state: "active",
      scopes: requestedScopes,
      limit: 5,
    });
    return {
      available: true,
      checkedAt: result.checkedAt,
      items: result.items.map(
        ({ id, title, scopes, exitCondition, expiresAt, creator }) => ({
          id,
          title,
          scopes,
          exitCondition:
            exitCondition === null || exitCondition.length <= 1000
              ? exitCondition
              : `${exitCondition.slice(0, 1000)}… [read full condition with toolkit forum view]`,
          expiresAt,
          creator,
        }),
      ),
      total: result.total,
      error: null,
    };
  } catch {
    // Never print arbitrary remote response bodies into credential-bearing commands.
    return {
      available: false,
      checkedAt,
      items: [],
      total: null,
      error:
        "Tracker notices unavailable; run toolkit forum list --kind notice for details.",
    };
  }
}

export function formatCoordination(summary: CoordinationSummary): string {
  if (!summary.available)
    return `Coordination: ${summary.error ?? "unavailable"}`;
  return [
    `Active notices: ${String(summary.items.length)} of ${String(summary.total)} (checked ${summary.checkedAt})`,
    ...summary.items.map(
      (item) =>
        `  ${item.id}: ${item.title} [${item.scopes.join(", ") || "global"}] — ${item.creator.key}\n    Exit: ${item.exitCondition ?? ""}`,
    ),
    "Read threads: toolkit forum list --kind notice; toolkit forum view <ID>",
  ].join("\n");
}
