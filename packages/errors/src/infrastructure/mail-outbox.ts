import { z } from "zod";
import type { FetchLike } from "#infrastructure/bugsink-importer.ts";
import type {
  ClaimedOutboxNotification,
  ErrorsRepository,
} from "#infrastructure/repository-types.ts";

const MailOutboxConfigSchema = z.object({
  baseUrl: z.url().transform((url) => url.replace(/\/+$/u, "")),
  token: z.string().min(1),
  from: z.string().trim().min(3),
  to: z.email(),
});

const MailQueuedReceiptSchema = z.object({
  id: z.string().min(1),
  rfcMessageId: z.string().min(1),
  status: z.enum(["queued", "sending", "retrying", "sent", "failed"]),
  deduplicated: z.boolean(),
});

export type MailClientOptions = z.input<typeof MailOutboxConfigSchema> & {
  readonly fetchFn?: FetchLike | undefined;
};

export type OutboxEmailMessage = {
  readonly subject: string;
  readonly htmlBody: string;
  readonly plainBody: string;
  readonly messageId: string;
  readonly tag: string;
};

export type MailSender = {
  readonly send: (message: OutboxEmailMessage) => Promise<void>;
};

function escapeHtml(raw: string): string {
  return raw
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function computeOutboxBackoffMs(attempts: number): number {
  const exponent = Math.max(0, Math.min(10, attempts));
  return Math.min(60 * 60_000, 30_000 * 2 ** exponent);
}

export function renderOutboxAlertEmail(
  item: ClaimedOutboxNotification,
  consolePublicOrigin: string,
): OutboxEmailMessage {
  const baseOrigin = consolePublicOrigin.replace(/\/+$/u, "");
  const issueUrl = `${baseOrigin}/issues/${item.issueId}`;
  const kindLabel = item.kind === "REGRESSION" ? "Regression" : "New issue";
  const subject = `[Errors] ${kindLabel} in ${item.projectName}: ${item.issueType}`;
  const preview = item.stacktraceMd.trim().slice(0, 2400);

  const metaLines: string[] = [
    `Project: ${item.projectName} (${item.projectSlug})`,
  ];
  if (item.transaction.length > 0) {
    metaLines.push(`Transaction: ${item.transaction}`);
  }
  if (item.release !== null) {
    metaLines.push(`Release: ${item.release}`);
  }
  if (item.environment !== null) {
    metaLines.push(`Environment: ${item.environment}`);
  }

  const plainBody = [
    `${kindLabel}: ${item.issueType}`,
    item.issueValue,
    "",
    ...metaLines,
    `Issue URL: ${issueUrl}`,
    "",
    preview,
  ].join("\n");

  const htmlMetaItems = metaLines
    .map((line) => `<li>${escapeHtml(line)}</li>`)
    .join("");
  const htmlBody = [
    '<div style="font-family: ui-sans-serif, system-ui, sans-serif; color: #111827; line-height: 1.5;">',
    `<h2 style="margin: 0 0 8px;">${escapeHtml(kindLabel)} in ${escapeHtml(item.projectName)}</h2>`,
    `<p style="margin: 0 0 12px;"><strong>${escapeHtml(item.issueType)}</strong>: ${escapeHtml(item.issueValue)}</p>`,
    `<ul style="margin: 0 0 16px; padding-left: 20px;">${htmlMetaItems}</ul>`,
    `<p style="margin: 0 0 16px;"><a href="${escapeHtml(issueUrl)}" style="color: #b91c1c; font-weight: 600;">Open issue in Errors console</a></p>`,
    preview.length > 0
      ? `<pre style="background: #f3f4f6; padding: 12px; border-radius: 6px; overflow-x: auto; font-size: 12px;">${escapeHtml(preview)}</pre>`
      : "",
    "</div>",
  ].join("\n");

  return {
    subject,
    htmlBody,
    plainBody,
    messageId: item.messageId,
    tag: item.kind === "REGRESSION" ? "errors-regression" : "errors-new-issue",
  };
}

export function createMailOutboxClient(options: MailClientOptions): MailSender {
  const config = MailOutboxConfigSchema.parse(options);
  const fetchFn = options.fetchFn ?? globalThis.fetch;

  return {
    send: async (message) => {
      const response = await fetchFn(`${config.baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.token}`,
        },
        body: JSON.stringify({
          to: [config.to],
          from: config.from,
          subject: message.subject,
          htmlBody: message.htmlBody,
          plainBody: message.plainBody,
          idempotencyKey: message.messageId,
          messageId: message.messageId,
          tag: message.tag,
        }),
        signal: AbortSignal.timeout(15_000),
      });

      const bodyText = await response.text();
      if (!response.ok) {
        throw new Error(
          `Mail API returned ${String(response.status)}: ${bodyText.slice(0, 300)}`,
        );
      }
      const parsedJson: unknown = JSON.parse(bodyText);
      MailQueuedReceiptSchema.parse(parsedJson);
    },
  };
}

export type DispatchOutboxSummary = {
  readonly claimed: number;
  readonly sent: number;
  readonly failed: number;
};

export async function dispatchPendingOutbox(options: {
  readonly repo: ErrorsRepository;
  readonly mail: MailSender | null;
  readonly consolePublicOrigin: string;
  readonly emailNotificationsEnabled: () => Promise<boolean>;
  readonly batchSize?: number | undefined;
  readonly now?: Date | undefined;
}): Promise<DispatchOutboxSummary> {
  if (options.mail === null || !(await options.emailNotificationsEnabled())) {
    return { claimed: 0, sent: 0, failed: 0 };
  }

  const currentNow = options.now ?? new Date();
  const claimedRows = await options.repo.claimPendingOutbox(
    options.batchSize ?? 20,
    currentNow,
  );
  let sent = 0;
  let failed = 0;

  for (const item of claimedRows) {
    const email = renderOutboxAlertEmail(item, options.consolePublicOrigin);
    try {
      await options.mail.send(email);
      await options.repo.completeOutbox(item.id, currentNow);
      sent += 1;
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Unknown outbound mail delivery error";
      const nextAttemptAt = new Date(
        currentNow.getTime() + computeOutboxBackoffMs(item.attempts),
      );
      await options.repo.failOutbox(item.id, errorMessage, nextAttemptAt);
      failed += 1;
    }
  }

  return { claimed: claimedRows.length, sent, failed };
}
