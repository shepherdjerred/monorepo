import { z } from "zod/v4";

export const PromotionPolicySchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("rolling"),
    maxActions: z.number().int().positive().max(100),
    windowSeconds: z.number().int().positive(),
  }),
  z.strictObject({
    kind: z.literal("calendar-day"),
    maxActions: z.number().int().positive().max(100),
    timezone: z.string().refine((value) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }, "Expected an IANA timezone"),
  }),
]);
export type PromotionPolicy = z.infer<typeof PromotionPolicySchema>;

export const PromotionTargetSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  url: z.url().startsWith("https://"),
  rulesUrl: z.url().startsWith("https://"),
  account: z.string().min(1),
  hosts: z.array(z.string().min(1)).min(1),
  action: z.enum(["bump", "repost", "news", "inspect", "pending"]),
  content: z.enum(["directory", "reddit-mcservers", "reddit-minecraftserver"]),
  minimumIntervalSeconds: z.number().int().nonnegative(),
  notes: z.string().min(1),
  discord: z
    .strictObject({
      guildId: z.string().regex(/^\d+$/),
      channelId: z.string().regex(/^\d+$/),
      username: z.string().min(1),
    })
    .optional(),
});
export type PromotionTarget = z.infer<typeof PromotionTargetSchema>;

function assertDiscordAssignment(
  target: PromotionTarget,
  context: z.RefinementCtx,
): void {
  const url = new URL(target.url);
  if (target.discord === undefined) {
    if (url.hostname === "discord.com" && target.action !== "pending")
      context.addIssue({
        code: "custom",
        message: `${target.id}: Discord assignment metadata is required`,
      });
    return;
  }
  const parts = url.pathname.split("/").filter(Boolean);
  const channelId = parts[3] === "threads" ? parts[4] : parts[2];
  if (
    url.hostname !== "discord.com" ||
    parts[0] !== "channels" ||
    parts[1] !== target.discord.guildId ||
    channelId !== target.discord.channelId
  )
    context.addIssue({
      code: "custom",
      message: `${target.id}: Discord assignment does not match its URL`,
    });
}

export const PromotionManifestSchema = z
  .strictObject({
    version: z.literal(1),
    serverIdentity: z.literal("the-storm"),
    targets: z.array(PromotionTargetSchema).min(1),
  })
  .superRefine((value, context) => {
    const ids = value.targets.map((target) => target.id);
    if (new Set(ids).size !== ids.length)
      context.addIssue({
        code: "custom",
        message: "Duplicate promotion target",
      });
    for (const target of value.targets) {
      assertDiscordAssignment(target, context);
      for (const address of [target.url, target.rulesUrl]) {
        if (!target.hosts.includes(new URL(address).hostname))
          context.addIssue({
            code: "custom",
            message: `${target.id}: URL outside declared hosts`,
          });
      }
    }
  });

export const PromotionObservationSchema = z.strictObject({
  id: z.uuid(),
  url: z.url(),
  capturedAt: z.iso.datetime(),
  text: z.string(),
});
export type PromotionObservation = z.infer<typeof PromotionObservationSchema>;

export const PromotionPreflightSchema = z.strictObject({
  policy: PromotionPolicySchema,
  ruleObservationId: z.uuid(),
  ruleQuote: z.string().min(10),
  historyObservationIds: z.array(z.uuid()).min(1),
  historyComplete: z.boolean(),
  // Include manual, removed and filtered attempts, across authors where the
  // rule applies to the server. An empty history is an explicit observation.
  previousActions: z.array(
    z.strictObject({
      occurredAt: z.iso.datetime(),
      observationId: z.uuid(),
      quote: z.string().min(1),
    }),
  ),
  nextAllowedAt: z.iso.datetime().nullable(),
  equivalentPostExists: z.boolean(),
  substantiveNewsAvailable: z.boolean(),
  explanation: z.string().min(10),
});
export type PromotionPreflight = z.infer<typeof PromotionPreflightSchema>;

export const PromotionAttemptSchema = z.strictObject({
  occurrenceId: z.string().min(1),
  attemptedAt: z.iso.datetime(),
  settledAt: z.iso.datetime().nullable(),
  status: z.enum([
    "uncertain",
    "verified",
    "filtered",
    "rejected",
    "no-action",
  ]),
  receiptUrl: z.url().nullable(),
  evidenceKey: z.string().nullable(),
  contentHash: z.string().min(1),
  contentExcerpt: z.string().max(1000).nullable().optional(),
  beforeSubmission: z.array(PromotionObservationSchema),
});
export type PromotionAttempt = z.infer<typeof PromotionAttemptSchema>;

export const PromotionStateSchema = z.strictObject({
  version: z.literal(1),
  targetId: z.string().min(1),
  paused: z.boolean(),
  blockedReason: z.string().nullable(),
  nextEligibleAt: z.iso.datetime().nullable(),
  // Chosen once per occurrence, including the first occurrence. Rechecks do
  // not regenerate jitter and accidentally move a due action forward forever.
  bufferSeconds: z.number().int().min(900).max(1800),
  lock: z
    .strictObject({ occurrenceId: z.string(), acquiredAt: z.iso.datetime() })
    .nullable(),
  attempts: z.array(PromotionAttemptSchema),
  preflight: PromotionPreflightSchema.nullable(),
  checkedAt: z.iso.datetime().nullable(),
  lastAlertFingerprint: z.string().nullable(),
  lastOccurrenceId: z.string().nullable(),
});
export type PromotionState = z.infer<typeof PromotionStateSchema>;

/** The caller checks saved cadence before starting an executor. */
export function promotionDispatchAt(
  target: PromotionTarget,
  state: PromotionState,
  occurrenceId?: string,
): number {
  const latest = Math.max(
    0,
    ...state.attempts
      .filter(
        (attempt) =>
          attempt.status !== "no-action" &&
          attempt.occurrenceId !== occurrenceId,
      )
      .map((attempt) => Date.parse(attempt.settledAt ?? attempt.attemptedAt)),
  );
  return Math.max(
    state.nextEligibleAt === null ? 0 : Date.parse(state.nextEligibleAt),
    latest === 0
      ? 0
      : latest + (target.minimumIntervalSeconds + state.bufferSeconds) * 1000,
  );
}

/** Keep stored page bodies out of Temporal results and provider context. */
export function promotionStateSummary(state: PromotionState) {
  return {
    ...state,
    attemptCount: state.attempts.length,
    attempts: state.attempts
      .slice(-50)
      .map(({ beforeSubmission, ...attempt }) => ({
        ...attempt,
        baselineObservationCount: beforeSubmission.length,
      })),
    preflight:
      state.preflight === null
        ? null
        : {
            policy: state.preflight.policy,
            historyComplete: state.preflight.historyComplete,
            previousActionCount: state.preflight.previousActions.length,
            nextAllowedAt: state.preflight.nextAllowedAt,
            equivalentPostExists: state.preflight.equivalentPostExists,
            substantiveNewsAvailable: state.preflight.substantiveNewsAvailable,
          },
  };
}

export function initialPromotionState(
  targetId: string,
  bufferSeconds: number,
): PromotionState {
  return PromotionStateSchema.parse({
    version: 1,
    targetId,
    paused: false,
    blockedReason: null,
    nextEligibleAt: null,
    bufferSeconds,
    lock: null,
    attempts: [],
    preflight: null,
    checkedAt: null,
    lastAlertFingerprint: null,
    lastOccurrenceId: null,
  });
}

export const PromotionRunInputSchema = z.strictObject({
  targetId: z.string().min(1),
  mode: z.enum(["run", "preview", "reconcile"]).default("run"),
});
export type PromotionRunInput = z.infer<typeof PromotionRunInputSchema>;

export const PromotionAgentResultSchema = z.strictObject({
  status: z.enum(["verified", "deferred", "blocked", "preview"]),
  summary: z.string().min(1),
});

export function assertPromotionUrl(
  target: PromotionTarget,
  address: string,
): URL {
  const url = new URL(address);
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    !target.hosts.includes(url.hostname)
  )
    throw new Error("Promotion URL outside target scope");
  if (
    target.id.startsWith("reddit-") &&
    !url.pathname
      .toLowerCase()
      .startsWith(new URL(target.url).pathname.toLowerCase()) &&
    !["/login", "/login/", "/prefs/", "/user/"].some((prefix) =>
      url.pathname.startsWith(prefix),
    )
  )
    throw new Error("Reddit URL outside target community or account history");
  return url;
}

function calendarDay(timestamp: number, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(timestamp);
}

/** Find the next real timezone day boundary, including DST transitions. */
function nextDayBoundary(now: number, timezone: string): number {
  const currentDay = calendarDay(now, timezone);
  let low = now;
  let high = now + 27 * 60 * 60 * 1000;
  while (high - low > 1000) {
    const middle = Math.floor((low + high) / 2000) * 1000;
    if (calendarDay(middle, timezone) === currentDay) low = middle;
    else high = middle;
  }
  return Math.ceil(high / 1000) * 1000;
}

export function policyEligibleAt(
  policy: PromotionPolicy,
  actions: readonly number[],
  now: number,
): number {
  if (
    actions.some((timestamp) => !Number.isFinite(timestamp) || timestamp > now)
  )
    throw new Error("Invalid or future submission timestamp");
  if (policy.kind === "calendar-day") {
    const days = new Map<string, { count: number; latest: number }>();
    for (const timestamp of actions) {
      const key = calendarDay(timestamp, policy.timezone);
      const current = days.get(key);
      days.set(key, {
        count: (current?.count ?? 0) + 1,
        latest: Math.max(current?.latest ?? 0, timestamp),
      });
    }
    return Math.max(
      0,
      ...[...days.values()]
        .filter((day) => day.count >= policy.maxActions)
        .map((day) => nextDayBoundary(day.latest, policy.timezone)),
    );
  }
  // Retain an expired boundary: the caller still adds its safety buffer.
  const recent = actions.toSorted((a, b) => b - a);
  const limiting = recent[policy.maxActions - 1];
  return limiting === undefined ? 0 : limiting + policy.windowSeconds * 1000;
}

/** A visible receipt conservatively anchors the next posting window. */
export function nextPromotionEligibleAt(
  target: PromotionTarget,
  state: PromotionState,
  now: number,
): string {
  if (state.preflight === null)
    throw new Error("Verified promotion has no recorded posting policy");
  const times = [
    ...new Set(
      state.attempts
        .filter((attempt) => attempt.status !== "no-action")
        .map((attempt) => Date.parse(attempt.settledAt ?? attempt.attemptedAt)),
    ),
  ];
  const latest = Math.max(0, ...times);
  return new Date(
    Math.max(
      now,
      policyEligibleAt(state.preflight.policy, times, now),
      latest + target.minimumIntervalSeconds * 1000,
    ) +
      state.bufferSeconds * 1000,
  ).toISOString();
}
