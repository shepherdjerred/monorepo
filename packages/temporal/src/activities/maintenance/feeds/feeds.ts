import { z } from "zod";

const NonNegativeCountSchema = z.number().int().nonnegative();

export const FeedsRefreshSummarySchema = z.object({
  skippedByFlag: z.boolean(),
  polled: NonNegativeCountSchema,
  notModified: NonNegativeCountSchema,
  updated: NonNegativeCountSchema,
  failed: NonNegativeCountSchema,
  backedOff: NonNegativeCountSchema,
  newEntries: NonNegativeCountSchema,
  autoReadEntries: NonNegativeCountSchema,
});

export type FeedsRefreshSummary = z.infer<typeof FeedsRefreshSummarySchema>;

export type FeedsMaintenanceActivities = {
  triggerFeedsRefresh: () => Promise<FeedsRefreshSummary>;
};

export type FeedsHttpFetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type TriggerFeedsRefreshDeps = {
  readonly env?: Readonly<Record<string, string | undefined>> | undefined;
  readonly fetchImpl?: FeedsHttpFetcher | undefined;
};

export async function triggerFeedsRefreshWithDeps(
  deps: TriggerFeedsRefreshDeps = {},
): Promise<FeedsRefreshSummary> {
  const env = deps.env ?? Bun.env;
  const fetchImpl: FeedsHttpFetcher = deps.fetchImpl ?? fetch;
  const baseUrl = env["FEEDS_URL"]?.trim().replace(/\/+$/u, "");
  const machineToken = env["FEEDS_MACHINE_TOKEN"]?.trim();
  if (baseUrl === undefined || baseUrl.length === 0) {
    throw new Error("FEEDS_URL is required for triggerFeedsRefresh");
  }
  if (machineToken === undefined || machineToken.length === 0) {
    throw new Error("FEEDS_MACHINE_TOKEN is required for triggerFeedsRefresh");
  }

  const response = await fetchImpl(`${baseUrl}/internal/refresh`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${machineToken}`,
      accept: "application/json",
    },
    signal: AbortSignal.timeout(180_000),
  });

  if (!response.ok) {
    const rawBody = await response.text();
    const body = rawBody.slice(0, 200);
    throw new Error(
      `feeds /internal/refresh returned HTTP ${String(response.status)}: ${body}`,
    );
  }

  return FeedsRefreshSummarySchema.parse(await response.json());
}

export const feedsActivities: FeedsMaintenanceActivities = {
  triggerFeedsRefresh: () => triggerFeedsRefreshWithDeps(),
};
