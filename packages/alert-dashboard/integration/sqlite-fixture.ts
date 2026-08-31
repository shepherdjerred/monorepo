import { PrismaLibSql } from "@prisma/adapter-libsql";
import { z } from "zod";

import { PrismaClient } from "#generated/prisma/client/index.js";
import type { IngestWebhookInput } from "#application/ports";
import { createPrismaRepository } from "#infrastructure/prisma-repository";
import { AlertmanagerWebhookSchema, JsonObjectSchema } from "#shared/schema";
import { InstantTextSchema, instantTextToEpochNanoseconds } from "#shared/time";

const DatabaseUrlSchema = z.url().startsWith("file:");
export const IndexRowSchema = z.array(z.object({ indexname: z.string() }));
const databaseUrl = DatabaseUrlSchema.parse(Bun.env["DATABASE_URL"]);
export const prisma = new PrismaClient({
  adapter: new PrismaLibSql({ url: databaseUrl, intMode: "bigint" }),
});
export const repository = await createPrismaRepository(databaseUrl);

export function nanoseconds(value: string): bigint {
  return instantTextToEpochNanoseconds(InstantTextSchema.parse(value));
}

export async function waitForDatabase(): Promise<void> {
  let failure: unknown;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return;
    } catch (error) {
      failure = error;
      await Bun.sleep(1000);
    }
  }
  throw failure;
}

export async function resetDatabase(): Promise<void> {
  await prisma.$transaction([
    prisma.webhookDeliveryOccurrence.deleteMany(),
    prisma.alertOccurrenceLabel.deleteMany(),
    prisma.alertEvent.deleteMany(),
    prisma.emailOutbox.deleteMany(),
    prisma.webhookDelivery.deleteMany(),
    prisma.snapshotRun.deleteMany(),
    prisma.alertOccurrence.deleteMany(),
  ]);
}

export async function disconnectDatabase(): Promise<void> {
  await repository.disconnect();
  await prisma.$disconnect();
}

export function webhook(
  fingerprint: string,
  status: "firing" | "resolved",
  startsAt = "2026-08-08T18:00:00Z",
  severity: "warning" | "info" = "warning",
) {
  return AlertmanagerWebhookSchema.parse({
    version: "4",
    groupKey: '{}:{alertname="DiskFull"}',
    truncatedAlerts: 0,
    status,
    receiver: "alert-dashboard",
    groupLabels: { alertname: "DiskFull" },
    commonLabels: { alertname: "DiskFull", severity },
    commonAnnotations: { summary: "Disk is full" },
    externalURL: "https://alertmanager.tailnet-1a49.ts.net",
    alerts: [
      {
        status,
        labels: {
          alertname: "DiskFull",
          severity,
          namespace: "storage",
        },
        annotations: { summary: "Disk is full" },
        startsAt,
        endsAt:
          status === "resolved"
            ? "2026-08-08T18:10:00Z"
            : "0001-01-01T00:00:00Z",
        generatorURL: "https://prometheus.tailnet-1a49.ts.net/graph?g0.expr=up",
        fingerprint,
      },
    ],
  });
}

/**
 * A `TemporalWorkflowFailed` webhook — the alert family the incident-email
 * cancellation path keys on. Re-labels the generic {@link webhook} fixture so
 * the cancellation tests share one definition of that alert.
 */
export function temporalFailureWebhook(
  fingerprint: string,
): ReturnType<typeof webhook> {
  const base = webhook(fingerprint, "firing");
  return AlertmanagerWebhookSchema.parse({
    ...base,
    groupKey: '{}:{alertname="TemporalWorkflowFailed"}',
    groupLabels: { alertname: "TemporalWorkflowFailed" },
    commonLabels: {
      alertname: "TemporalWorkflowFailed",
      severity: "warning",
    },
    alerts: base.alerts.map((alert) => ({
      ...alert,
      labels: { ...alert.labels, alertname: "TemporalWorkflowFailed" },
    })),
  });
}

export function input(
  payload: ReturnType<typeof webhook>,
  receivedAt: string,
  emailEnabled = true,
): IngestWebhookInput {
  const receivedAtNs = nanoseconds(receivedAt);
  return {
    payload,
    rawPayload: JsonObjectSchema.parse(payload),
    payloadHash: "a".repeat(64),
    receivedAtNs,
    rawExpiresAtNs: receivedAtNs + 1_000_000_000n,
    emailEnabled,
  };
}
