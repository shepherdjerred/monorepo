import nodemailer, { type Transporter } from "nodemailer";
import { z } from "zod";
import type { AttemptOutcome } from "@shepherdjerred/mail/shared/contract.ts";
import type { MailMetrics } from "./metrics.ts";
import type { ClaimedMessage, MailStore } from "./store.ts";

const MAX_ATTEMPTS = 12;
const BASE_BACKOFF_SECONDS = 15;
const MAX_BACKOFF_SECONDS = 900;

const SmtpErrorShapeSchema = z.object({
  responseCode: z.number().int().optional(),
  response: z.string().optional(),
  message: z.string().optional(),
});

const SentInfoShapeSchema = z.object({
  response: z.string().optional(),
});

export type RawMailDeliveryInput = {
  readonly from: string;
  readonly to: readonly string[];
  readonly rawMime: Uint8Array;
};

export type RawMailDeliveryResult = {
  readonly smtpCode: number | null;
  readonly smtpResponse: string | null;
};

export type RelayWorkerOptions = {
  readonly store: MailStore;
  readonly fastmailHost: string;
  readonly fastmailPort: number;
  readonly fastmailUsername?: string;
  readonly fastmailPassword?: string;
  readonly fastmailRequireTls: boolean;
  readonly isRelayEnabled: () => Promise<boolean>;
  readonly metrics?: MailMetrics;
  readonly now?: () => Date;
  readonly sendRawMail?: (
    input: RawMailDeliveryInput,
  ) => Promise<RawMailDeliveryResult>;
};

function parseLeadingSmtpCode(text: string | undefined): number | null {
  if (text === undefined) {
    return null;
  }
  const match = /^(\d{3})\b/u.exec(text.trim());
  return match?.[1] === undefined ? null : Number(match[1]);
}

export function computeRetryBackoffSeconds(
  attemptNumber: number,
  smtpHintSource: string | null,
): number {
  if (smtpHintSource !== null) {
    const minutesMatch = /(\d+)\s*minutes?/iu.exec(smtpHintSource);
    if (minutesMatch?.[1] !== undefined) {
      const hintedSeconds = Number(minutesMatch[1]) * 60;
      return Math.min(MAX_BACKOFF_SECONDS, Math.max(1, hintedSeconds));
    }
    const secondsMatch = /(\d+)\s*seconds?/iu.exec(smtpHintSource);
    if (secondsMatch?.[1] !== undefined) {
      const hintedSeconds = Number(secondsMatch[1]);
      return Math.min(MAX_BACKOFF_SECONDS, Math.max(0, hintedSeconds));
    }
  }
  const expSeconds = BASE_BACKOFF_SECONDS * 2 ** Math.max(0, attemptNumber - 1);
  return Math.min(MAX_BACKOFF_SECONDS, expSeconds);
}

function classifyRelayError(
  error: unknown,
  attemptNumber: number,
): {
  readonly outcome: AttemptOutcome;
  readonly smtpCode: number | null;
  readonly smtpResponse: string | null;
  readonly errorMessage: string;
  readonly backoffSeconds: number;
} {
  const parsedErr = SmtpErrorShapeSchema.safeParse(error);
  const smtpResponse = parsedErr.success
    ? (parsedErr.data.response ?? null)
    : null;
  const smtpCode =
    (parsedErr.success ? parsedErr.data.responseCode : undefined) ??
    parseLeadingSmtpCode(smtpResponse ?? undefined);
  const errorMessage =
    parsedErr.success && parsedErr.data.message !== undefined
      ? parsedErr.data.message
      : error instanceof Error
        ? error.message
        : String(error);

  const isPermanentSmtp =
    smtpCode !== null && smtpCode >= 500 && smtpCode <= 599;
  const outcome: AttemptOutcome =
    isPermanentSmtp || attemptNumber >= MAX_ATTEMPTS
      ? "permanent_error"
      : "transient_error";

  const backoffSeconds =
    outcome === "transient_error"
      ? computeRetryBackoffSeconds(attemptNumber, smtpResponse ?? errorMessage)
      : 0;

  return { outcome, smtpCode, smtpResponse, errorMessage, backoffSeconds };
}

export class RelayWorker {
  readonly #store: MailStore;
  readonly #isRelayEnabled: () => Promise<boolean>;
  readonly #metrics: MailMetrics | undefined;
  readonly #now: () => Date;
  readonly #customSend:
    | ((input: RawMailDeliveryInput) => Promise<RawMailDeliveryResult>)
    | undefined;
  readonly #transporter: Transporter | null;
  readonly #missingCredentials: boolean;

  #stopped = false;
  #wakePending = false;
  #wakeResolve: (() => void) | null = null;
  #activeTimeout: ReturnType<typeof setTimeout> | null = null;
  #loopPromise: Promise<void> | null = null;

  constructor(options: RelayWorkerOptions) {
    this.#store = options.store;
    this.#isRelayEnabled = options.isRelayEnabled;
    this.#metrics = options.metrics;
    this.#now = options.now ?? (() => new Date());
    this.#customSend = options.sendRawMail;

    if (options.sendRawMail !== undefined) {
      this.#transporter = null;
      this.#missingCredentials = false;
    } else if (
      options.fastmailUsername === undefined ||
      options.fastmailUsername.length === 0 ||
      options.fastmailPassword === undefined ||
      options.fastmailPassword.length === 0
    ) {
      this.#transporter = null;
      this.#missingCredentials = true;
    } else {
      this.#missingCredentials = false;
      this.#transporter = nodemailer.createTransport({
        host: options.fastmailHost,
        port: options.fastmailPort,
        secure: options.fastmailPort === 465,
        requireTLS: options.fastmailRequireTls,
        pool: true,
        maxConnections: 2,
        connectionTimeout: 15_000,
        greetingTimeout: 15_000,
        socketTimeout: 30_000,
        auth: {
          user: options.fastmailUsername,
          pass: options.fastmailPassword,
        },
      });
    }
  }

  start(): void {
    if (this.#loopPromise !== null || this.#stopped) {
      return;
    }
    this.#loopPromise = this.#runLoop();
  }

  notify(): void {
    this.#wakePending = true;
    const resolve = this.#wakeResolve;
    if (resolve !== null) {
      this.#wakeResolve = null;
      resolve();
    }
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    if (this.#activeTimeout !== null) {
      clearTimeout(this.#activeTimeout);
      this.#activeTimeout = null;
    }
    this.notify();
    if (this.#loopPromise !== null) {
      await this.#loopPromise;
      this.#loopPromise = null;
    }
    this.#transporter?.close();
  }

  async #waitForWakeOrDelay(delayMs: number | null): Promise<void> {
    if (this.#stopped || this.#wakePending) {
      return;
    }
    if (delayMs !== null && delayMs <= 0) {
      return;
    }

    const wakeupPromise = new Promise<void>((resolve) => {
      this.#wakeResolve = resolve;
    });

    if (delayMs === null) {
      await wakeupPromise;
      return;
    }

    let timeoutResolve: (() => void) | undefined;
    const boundedTimeout = new Promise<void>((resolve) => {
      timeoutResolve = resolve;
    });
    const handle = setTimeout(() => {
      timeoutResolve?.();
    }, delayMs);
    this.#activeTimeout = handle;

    try {
      await Promise.race([wakeupPromise, boundedTimeout]);
    } finally {
      clearTimeout(handle);
      if (this.#activeTimeout === handle) {
        this.#activeTimeout = null;
      }
      this.#wakeResolve = null;
    }
  }

  async #sendViaTransport(
    claimed: ClaimedMessage,
  ): Promise<RawMailDeliveryResult> {
    if (this.#customSend !== undefined) {
      return this.#customSend({
        from: claimed.mailFrom,
        to: claimed.recipients,
        rawMime: claimed.rawMime,
      });
    }
    if (this.#transporter === null) {
      throw new Error("Upstream SMTP transporter is not initialized");
    }
    const rawInfo: unknown = await this.#transporter.sendMail({
      envelope: {
        from: claimed.mailFrom,
        to: [...claimed.recipients],
      },
      raw: Buffer.from(claimed.rawMime),
    });
    const parsedInfo = SentInfoShapeSchema.safeParse(rawInfo);
    const smtpResponse = parsedInfo.success
      ? (parsedInfo.data.response ?? null)
      : null;
    const smtpCode = parseLeadingSmtpCode(smtpResponse ?? undefined) ?? 250;
    return { smtpCode, smtpResponse };
  }

  #recordMissingCredentials(
    claimed: ClaimedMessage,
    startedDate: Date,
    startedNs: number,
  ): void {
    const finishedDate = this.#now();
    const durationMs = Math.max(
      0,
      Math.round((Bun.nanoseconds() - startedNs) / 1_000_000),
    );
    this.#store.recordAttempt({
      messageId: claimed.id,
      startedAt: startedDate.toISOString(),
      finishedAt: finishedDate.toISOString(),
      durationMs,
      outcome: "permanent_error",
      smtpCode: null,
      smtpResponse: null,
      error: "Fastmail SMTP credentials are not configured",
    });
    this.#metrics?.deliveryAttemptsTotal.inc({
      outcome: "permanent_error",
      protocol: claimed.protocol,
    });
    this.#metrics?.relayDurationSeconds.observe(
      { outcome: "permanent_error" },
      durationMs / 1000,
    );
  }

  async #deliverClaimed(claimed: ClaimedMessage): Promise<void> {
    const startedDate = this.#now();
    const startedNs = Bun.nanoseconds();
    if (this.#missingCredentials) {
      this.#recordMissingCredentials(claimed, startedDate, startedNs);
      return;
    }

    try {
      const delivery = await this.#sendViaTransport(claimed);
      const finishedDate = this.#now();
      const elapsedSeconds = Math.max(
        0,
        (Bun.nanoseconds() - startedNs) / 1_000_000_000,
      );

      this.#store.recordAttempt({
        messageId: claimed.id,
        startedAt: startedDate.toISOString(),
        finishedAt: finishedDate.toISOString(),
        durationMs: Math.round(elapsedSeconds * 1000),
        outcome: "sent",
        smtpCode: delivery.smtpCode,
        smtpResponse: delivery.smtpResponse,
        error: null,
      });

      this.#metrics?.deliveryAttemptsTotal.inc({
        outcome: "sent",
        protocol: claimed.protocol,
      });
      this.#metrics?.relayDurationSeconds.observe(
        { outcome: "sent" },
        elapsedSeconds,
      );
      const queueLatencySeconds = Math.max(
        0,
        (finishedDate.getTime() - new Date(claimed.createdAt).getTime()) / 1000,
      );
      this.#metrics?.queueLatencySeconds.observe(
        { protocol: claimed.protocol },
        queueLatencySeconds,
      );
    } catch (error) {
      const finishedDate = this.#now();
      const elapsedSeconds = Math.max(
        0,
        (Bun.nanoseconds() - startedNs) / 1_000_000_000,
      );
      const classified = classifyRelayError(error, claimed.attemptCount + 1);
      const nextAttemptAt = new Date(
        finishedDate.getTime() + classified.backoffSeconds * 1000,
      ).toISOString();

      this.#store.recordAttempt({
        messageId: claimed.id,
        startedAt: startedDate.toISOString(),
        finishedAt: finishedDate.toISOString(),
        durationMs: Math.round(elapsedSeconds * 1000),
        outcome: classified.outcome,
        nextAttemptAt,
        smtpCode: classified.smtpCode,
        smtpResponse: classified.smtpResponse,
        error: classified.errorMessage,
      });

      this.#metrics?.deliveryAttemptsTotal.inc({
        outcome: classified.outcome,
        protocol: claimed.protocol,
      });
      this.#metrics?.relayDurationSeconds.observe(
        { outcome: classified.outcome },
        elapsedSeconds,
      );
    }
  }

  async #checkRelayEnabled(): Promise<boolean> {
    try {
      return await this.#isRelayEnabled();
    } catch {
      return true;
    }
  }

  async #runLoop(): Promise<void> {
    while (!this.#stopped) {
      this.#wakePending = false;

      const enabled = await this.#checkRelayEnabled();
      this.#metrics?.relayEnabled.set(enabled ? 1 : 0);

      if (!enabled) {
        await this.#waitForWakeOrDelay(null);
        continue;
      }

      const claimed = this.#store.claimNextDue(this.#now().toISOString());
      if (claimed !== null) {
        await this.#deliverClaimed(claimed);
        continue;
      }

      const nextDueIso = this.#store.nextDueTimestamp();
      const delayMs =
        nextDueIso === null
          ? null
          : Math.max(0, new Date(nextDueIso).getTime() - this.#now().getTime());
      await this.#waitForWakeOrDelay(delayMs);
    }
  }
}
