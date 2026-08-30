import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";

import type {
  AlertLedgerRepository,
  AlertmanagerPort,
  PostalPort,
  PreviewPort,
} from "#application/ports";
import {
  AlertListInputSchema,
  AlertDetailInputSchema,
  AlertmanagerWebhookSchema,
  EventListInputSchema,
  JsonObjectSchema,
  PreviewInputSchema,
  type AlertDetail,
  type AlertDetailInput,
  type AlertListInput,
  type AlertListResponse,
  type EventListInput,
  type EventListResponse,
  type PreviewInput,
  type Previews,
  type Summary,
  type SystemStatus,
} from "#shared/schema";
import { addDuration, type Clock } from "#shared/time";

const SNAPSHOT_MISSING_GRACE_NS = 300_000_000_000n;
const RAW_RETENTION = Temporal.Duration.from({ hours: 90 * 24 });
const OUTBOX_MAX_BACKOFF_SECONDS = 3600;
const JsonTextSchema = z.string().transform((text, context) => {
  try {
    return JsonObjectSchema.parse(JSON.parse(text) as unknown);
  } catch (error) {
    context.addIssue({
      code: "custom",
      message:
        error instanceof z.ZodError
          ? z.prettifyError(error)
          : "Invalid JSON body",
    });
    return z.NEVER;
  }
});

export type AlertServiceOptions = {
  repository: AlertLedgerRepository;
  alertmanager: AlertmanagerPort;
  postal: PostalPort;
  previews: PreviewPort;
  clock: Clock;
  emailEnabled: boolean;
};

export class AlertService {
  readonly #repository: AlertLedgerRepository;
  readonly #alertmanager: AlertmanagerPort;
  readonly #postal: PostalPort;
  readonly #previews: PreviewPort;
  readonly #clock: Clock;
  readonly #emailEnabled: boolean;

  constructor(options: AlertServiceOptions) {
    this.#repository = options.repository;
    this.#alertmanager = options.alertmanager;
    this.#postal = options.postal;
    this.#previews = options.previews;
    this.#clock = options.clock;
    this.#emailEnabled = options.emailEnabled;
  }

  async ingestWebhook(rawBody: string): Promise<{
    deliveryId: string;
    opened: number;
    resolved: number;
    emailQueued: boolean;
  }> {
    const rawPayload = JsonTextSchema.parse(rawBody);
    const payload = AlertmanagerWebhookSchema.parse(rawPayload);
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(rawBody);
    const receivedAtNs = this.#clock.now().epochNanoseconds;
    return this.#repository.ingestWebhook({
      payload,
      rawPayload,
      payloadHash: hasher.digest("hex"),
      receivedAtNs,
      rawExpiresAtNs: addDuration(receivedAtNs, RAW_RETENTION),
      emailEnabled: this.#emailEnabled,
    });
  }

  async reconcile(): Promise<{
    active: number;
    opened: number;
    resolved: number;
  }> {
    const startedAtNs = this.#clock.now().epochNanoseconds;
    try {
      const alerts = await this.#alertmanager.activeAlerts();
      const completedAtNs = this.#clock.now().epochNanoseconds;
      return await this.#repository.reconcileSnapshot({
        alerts,
        startedAtNs,
        completedAtNs,
        missingGraceNs: SNAPSHOT_MISSING_GRACE_NS,
      });
    } catch (error) {
      const completedAtNs = this.#clock.now().epochNanoseconds;
      const message = error instanceof Error ? error.message : String(error);
      await this.#repository.recordSnapshotFailure(
        startedAtNs,
        completedAtNs,
        message,
      );
      throw error;
    }
  }

  listAlerts(input: AlertListInput): Promise<AlertListResponse> {
    return this.#repository.listAlerts(AlertListInputSchema.parse(input));
  }

  getAlert(input: AlertDetailInput): Promise<AlertDetail | null> {
    return this.#repository.getAlert(AlertDetailInputSchema.parse(input));
  }

  listEvents(input: EventListInput): Promise<EventListResponse> {
    return this.#repository.listEvents(EventListInputSchema.parse(input));
  }

  summary(): Promise<Summary> {
    return this.#repository.summary();
  }

  async databaseReady(): Promise<boolean> {
    try {
      await this.#repository.checkDatabase();
      return true;
    } catch {
      return false;
    }
  }

  async systemStatus(): Promise<SystemStatus> {
    const status = await this.#repository.systemStatus(
      this.#emailEnabled,
      this.#clock.now().epochNanoseconds,
    );
    const grafanaHealthy = await this.#previews.health().catch(() => false);
    return { ...status, grafana: grafanaHealthy ? "ok" : "error" };
  }

  async previews(input: PreviewInput): Promise<Previews> {
    const parsed = PreviewInputSchema.parse(input);
    const alert = await this.#repository.getAlert({ id: parsed.id, limit: 1 });
    if (alert === null) throw new AlertNotFoundError(parsed.id);
    return this.#previews.previews(parsed, alert);
  }

  async drainEmailOutbox(limit = 10): Promise<number> {
    if (!this.#emailEnabled) return 0;
    const nowNs = this.#clock.now().epochNanoseconds;
    const messages = await this.#repository.claimPendingEmails(
      nowNs,
      limit,
      nowNs,
    );
    for (const message of messages) {
      try {
        await this.#postal.send(message);
        await this.#repository.markEmailSent({
          id: message.id,
          sendClaimId: message.sendClaimId,
          sentAtNs: this.#clock.now().epochNanoseconds,
        });
      } catch (error) {
        const failedAtNs = this.#clock.now().epochNanoseconds;
        const exponent = Math.min(message.attemptCount, 16);
        const delaySeconds = Math.min(
          30 * 2 ** exponent,
          OUTBOX_MAX_BACKOFF_SECONDS,
        );
        await this.#repository.markEmailFailed({
          id: message.id,
          sendClaimId: message.sendClaimId,
          failedAtNs,
          nextAttemptAtNs: addDuration(failedAtNs, {
            seconds: delaySeconds,
          }),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return messages.length;
  }

  purgeExpiredRawPayloads(): Promise<number> {
    return this.#repository.purgeExpiredRawPayloads(
      this.#clock.now().epochNanoseconds,
    );
  }

  disconnect(): Promise<void> {
    return this.#repository.disconnect();
  }
}

export class AlertNotFoundError extends Error {
  constructor(id: string) {
    super(`Alert occurrence not found: ${id}`);
    this.name = "AlertNotFoundError";
  }
}
