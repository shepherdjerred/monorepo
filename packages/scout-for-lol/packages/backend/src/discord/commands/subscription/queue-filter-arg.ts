import {
  QueueTypeSchema,
  queueTypeToDisplayString,
  type QueueType,
  type SubscriptionFilterSpec,
} from "@scout-for-lol/data/index.ts";

// Discord caps autocomplete choices at 25 and both name/value at 100 chars.
const MAX_CHOICES = 25;
const MAX_CHOICE_LENGTH = 100;

export type ParseQueuesArgResult =
  | { ok: true; spec: SubscriptionFilterSpec | null }
  | { ok: false; invalid: string[] };

/**
 * Parse the comma-separated `queues` slash-command argument into a filter spec.
 * Empty/whitespace => null (notify all). Unknown tokens are collected and
 * surfaced so the caller can answer with a friendly, non-Sentry error (this is
 * user input at a system boundary).
 */
export function parseQueuesArg(
  raw: string | null | undefined,
): ParseQueuesArgResult {
  if (raw === null || raw === undefined || raw.trim() === "") {
    return { ok: true, spec: null };
  }
  const tokens = raw
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  const queues: QueueType[] = [];
  const invalid: string[] = [];
  for (const token of tokens) {
    const parsed = QueueTypeSchema.safeParse(token.toLowerCase());
    if (parsed.success) {
      if (!queues.includes(parsed.data)) {
        queues.push(parsed.data);
      }
    } else {
      invalid.push(token);
    }
  }

  if (invalid.length > 0) {
    return { ok: false, invalid };
  }
  if (queues.length === 0) {
    return { ok: true, spec: null };
  }
  return {
    ok: true,
    spec: { version: 1, filters: [{ type: "queue", queues }] },
  };
}

/**
 * Autocomplete for the comma-separated `queues` option. Suggests the remaining
 * queue types appended to whatever the user has already typed, so a single
 * field can build up a multi-queue list one pick at a time.
 */
export function suggestQueueCompletions(
  focused: string,
): { name: string; value: string }[] {
  const segments = focused.split(",");
  const completed = segments
    .slice(0, -1)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  const current = (segments.at(-1) ?? "").trim().toLowerCase();
  const alreadyChosen = new Set(
    completed.map((segment) => segment.toLowerCase()),
  );
  const prefix = completed.length > 0 ? `${completed.join(", ")}, ` : "";

  return QueueTypeSchema.options
    .filter((queue) => !alreadyChosen.has(queue) && queue.includes(current))
    .slice(0, MAX_CHOICES)
    .map((queue) => ({
      name: `${prefix}${queueTypeToDisplayString(queue)}`.slice(
        0,
        MAX_CHOICE_LENGTH,
      ),
      value: `${prefix}${queue}`.slice(0, MAX_CHOICE_LENGTH),
    }));
}
