import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from "prom-client";
import {
  createFlagMetricSet,
  createFlagMetricsRecorder,
} from "@shepherdjerred/feature-flags/observability.ts";

export function createMailMetrics(options?: {
  readonly register?: Registry;
  readonly collectDefaults?: boolean;
}) {
  const register = options?.register ?? new Registry();
  register.setDefaultLabels({ service: "mail" });
  if (options?.collectDefaults === true) {
    collectDefaultMetrics({ register, prefix: "mail_" });
  }

  const messagesIngestedTotal = new Counter({
    name: "mail_messages_ingested_total",
    help: "Total inbound messages accepted by protocol, client, and idempotency outcome",
    labelNames: ["protocol", "client_id", "deduplicated"] as const,
    registers: [register],
  });

  const deliveryAttemptsTotal = new Counter({
    name: "mail_delivery_attempts_total",
    help: "Total upstream SMTP delivery attempts by outcome and inbound protocol",
    labelNames: ["outcome", "protocol"] as const,
    registers: [register],
  });

  const relayDurationSeconds = new Histogram({
    name: "mail_relay_duration_seconds",
    help: "Duration of upstream SMTP relay attempts in seconds",
    labelNames: ["outcome"] as const,
    buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
    registers: [register],
  });

  const queueLatencySeconds = new Histogram({
    name: "mail_queue_latency_seconds",
    help: "End-to-end latency from message enqueue to sent delivery in seconds",
    labelNames: ["protocol"] as const,
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 15, 30, 60, 300, 900],
    registers: [register],
  });

  const outboxMessages = new Gauge({
    name: "mail_outbox_messages",
    help: "Current number of messages stored in the mail outbox by status",
    labelNames: ["status"] as const,
    registers: [register],
  });

  const smtpTlsCertExpiryTimestampSeconds = new Gauge({
    name: "mail_smtp_tls_cert_expiry_timestamp_seconds",
    help: "Unix timestamp in seconds when the active SMTP STARTTLS certificate expires",
    registers: [register],
  });

  const relayEnabled = new Gauge({
    name: "mail_relay_enabled",
    help: "Whether upstream Fastmail relay draining is currently enabled (1 = enabled, 0 = paused)",
    registers: [register],
  });

  const featureFlags = createFlagMetricsRecorder(
    createFlagMetricSet({
      counter: (definition) =>
        new Counter({ ...definition, registers: [register] }),
      gauge: (definition) =>
        new Gauge({ ...definition, registers: [register] }),
    }),
  );

  return {
    register,
    messagesIngestedTotal,
    deliveryAttemptsTotal,
    relayDurationSeconds,
    queueLatencySeconds,
    outboxMessages,
    smtpTlsCertExpiryTimestampSeconds,
    relayEnabled,
    featureFlags,
  };
}

export type MailMetrics = ReturnType<typeof createMailMetrics>;
