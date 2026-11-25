import {
  ReportRunIngestBatchSchema,
  ReportRunIngestItemSchema,
  type ReportRunIngestItem,
} from "@shepherdjerred/ops-model/reports/report-ingest.ts";
import { resolveMailAddressesForReport } from "#config/mail.ts";
import { log } from "#observability/log.ts";
import { reportHubIngestTotal } from "#observability/metrics-report.ts";
import {
  reportEyebrow,
  reportSubject,
} from "#shared/reports/report-presentation.ts";
import { renderReportHtml } from "#shared/reports/report-renderer.ts";
import type { ReportEnvelopeV1 } from "#shared/reports/report.ts";
import type { SkippedNotification } from "./report-notification-policy.ts";

export const HUB_REPORT_INGEST_BATCH_LIMIT = 50;
export const HUB_REPORT_INGEST_TIMEOUT_MS = 10_000;

export type HubReportDeliveryInput =
  | {
      deliveryStatus: "sent";
      messageId: string;
      acceptedAt: string;
    }
  | {
      deliveryStatus: "skipped";
      skipReason: "unchanged" | "superseded";
    };

export type HubIngestFetch = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

export type HubReportIngestDependencies = {
  env?: Readonly<Record<string, string | undefined>>;
  fetchImpl?: HubIngestFetch;
};

function nonEmptyEnv(
  env: Readonly<Record<string, string | undefined>>,
  key: string,
): string | undefined {
  const value = env[key]?.trim();
  return value === undefined || value === "" ? undefined : value;
}

export function resolveHubIngestConfig(
  env: Readonly<Record<string, string | undefined>> = Bun.env,
): { baseUrl: string; token: string } | undefined {
  const baseUrl =
    nonEmptyEnv(env, "OPS_DASHBOARD_URL") ??
    nonEmptyEnv(env, "ALERT_DASHBOARD_URL");
  const token = nonEmptyEnv(env, "OPS_INGEST_TOKEN");
  if (baseUrl === undefined || token === undefined) {
    return undefined;
  }
  return {
    baseUrl: baseUrl.replace(/\/+$/u, ""),
    token,
  };
}

export function buildHubReportIngestItem(input: {
  report: ReportEnvelopeV1;
  addresses: { sender: string; recipient: string };
  delivery: HubReportDeliveryInput;
}): ReportRunIngestItem {
  const { report, addresses, delivery } = input;
  return ReportRunIngestItemSchema.parse({
    report,
    subject: reportSubject(report),
    eyebrow: reportEyebrow(report.reportType),
    mailboxFrom: addresses.sender,
    mailboxTo: addresses.recipient,
    htmlBody: renderReportHtml(report),
    ...(delivery.deliveryStatus === "sent"
      ? {
          deliveryStatus: "sent",
          messageId: delivery.messageId,
          acceptedAt: delivery.acceptedAt,
        }
      : {
          deliveryStatus: "skipped",
          skipReason: delivery.skipReason,
        }),
  });
}

async function readResponseDetail(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 500);
  } catch {
    return "";
  }
}

export async function pushReportRunsToHub(
  items: readonly ReportRunIngestItem[],
  deps: HubReportIngestDependencies = {},
): Promise<{ pushed: number }> {
  const config = resolveHubIngestConfig(deps.env ?? Bun.env);
  if (config === undefined) {
    reportHubIngestTotal.inc({ outcome: "unconfigured" });
    return { pushed: 0 };
  }
  if (items.length === 0) {
    return { pushed: 0 };
  }

  const fetchImpl: HubIngestFetch =
    deps.fetchImpl ?? ((url, init) => fetch(url, init));
  const endpoint = `${config.baseUrl}/internal/v1/reports/runs`;
  let pushed = 0;

  for (
    let offset = 0;
    offset < items.length;
    offset += HUB_REPORT_INGEST_BATCH_LIMIT
  ) {
    const chunk = items.slice(offset, offset + HUB_REPORT_INGEST_BATCH_LIMIT);
    const batch = ReportRunIngestBatchSchema.parse({ items: chunk });
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(batch),
      signal: AbortSignal.timeout(HUB_REPORT_INGEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      const detail = await readResponseDetail(response);
      throw new Error(
        `Hub report ingest HTTP ${String(response.status)}: ${detail}`,
      );
    }
    reportHubIngestTotal.inc({ outcome: "succeeded" });
    pushed += batch.items.length;
  }

  return { pushed };
}

export type PushReportRunToHubFn = (input: {
  report: ReportEnvelopeV1;
  addresses: { sender: string; recipient: string };
  delivery: HubReportDeliveryInput;
}) => Promise<{ pushed: number }>;

export async function tryPushReportRunToHub(
  input: {
    report: ReportEnvelopeV1;
    addresses: { sender: string; recipient: string };
    delivery: HubReportDeliveryInput;
  },
  deps: HubReportIngestDependencies = {},
): Promise<{ pushed: number }> {
  try {
    const item = buildHubReportIngestItem(input);
    return await pushReportRunsToHub([item], deps);
  } catch (error: unknown) {
    reportHubIngestTotal.inc({ outcome: "failed" });
    log("warning", "Failed to push report run to Hub", {
      module: "report-hub-ingest",
      reportRunId: input.report.reportRunId,
      reportType: input.report.reportType,
      deliveryStatus: input.delivery.deliveryStatus,
      error,
    });
    return { pushed: 0 };
  }
}

export async function pushSentReportReceiptToHub(
  pushToHub: PushReportRunToHubFn,
  report: ReportEnvelopeV1,
  addresses: { sender: string; recipient: string },
  receipt: { messageId: string; acceptedAt: string },
): Promise<{ pushed: number }> {
  return pushToHub({
    report,
    addresses,
    delivery: {
      deliveryStatus: "sent",
      messageId: receipt.messageId,
      acceptedAt: receipt.acceptedAt,
    },
  });
}

export async function pushSkippedReportNotificationToHub(input: {
  report: ReportEnvelopeV1;
  skipped: SkippedNotification;
  resolveAddresses?: (
    reportType: string,
  ) => Promise<{ recipient: string; sender: string }>;
  readObservation?: (key: string) => Promise<ReportEnvelopeV1 | undefined>;
  pushToHub?: PushReportRunToHubFn;
}): Promise<{ pushed: number }> {
  const resolveAddresses =
    input.resolveAddresses ?? resolveMailAddressesForReport;
  const pushToHub = input.pushToHub ?? tryPushReportRunToHub;
  const archivedReport =
    input.skipped.completedAt === input.report.completedAt
      ? input.report
      : ((await input.readObservation?.(input.skipped.observationKey)) ?? {
          ...input.report,
          completedAt: input.skipped.completedAt,
        });
  const addresses = await resolveAddresses(archivedReport.reportType);
  return pushToHub({
    report: archivedReport,
    addresses,
    delivery: {
      deliveryStatus: "skipped",
      skipReason: input.skipped.reason,
    },
  });
}
