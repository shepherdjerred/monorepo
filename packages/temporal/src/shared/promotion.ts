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
  action: z.enum(["bump", "repost", "news", "pending"]),
  content: z.enum(["directory", "reddit-mcservers", "reddit-minecraftserver"]),
  minimumIntervalSeconds: z.number().int().nonnegative(),
  notes: z.string().min(1),
});
export type PromotionTarget = z.infer<typeof PromotionTargetSchema>;

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
  status: z.enum(["uncertain", "verified", "filtered", "rejected"]),
  receiptUrl: z.url().nullable(),
  evidenceKey: z.string().nullable(),
  contentHash: z.string().min(1),
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

type PromotionEligibilityInput = {
  target: PromotionTarget;
  state: PromotionState;
  preflight: PromotionPreflight;
  observations: readonly PromotionObservation[];
  now: number;
};

function evidenceActionTimes(input: PromotionEligibilityInput): number[] {
  const { target, state, preflight, observations, now } = input;
  const observed = new Map(observations.map((item) => [item.id, item]));
  const requireObservation = (id: string) => {
    const item = observed.get(id);
    if (
      item === undefined ||
      now - Date.parse(item.capturedAt) > 5 * 60_000 ||
      Date.parse(item.capturedAt) > now
    )
      throw new Error("Fresh browser evidence is required");
    assertPromotionUrl(target, item.url);
    return item;
  };
  const rule = requireObservation(preflight.ruleObservationId);
  if (!rule.text.includes(preflight.ruleQuote))
    throw new Error("Rule quote absent from captured evidence");
  assertObservedPostingPolicy(preflight);
  for (const id of preflight.historyObservationIds) requireObservation(id);
  const times = preflight.previousActions.map((action) => {
    if (
      !preflight.historyObservationIds.includes(action.observationId) ||
      !requireObservation(action.observationId).text.includes(action.quote)
    )
      throw new Error("Submission history lacks captured evidence");
    return Date.parse(action.occurredAt);
  });
  for (const attempt of state.attempts)
    times.push(Date.parse(attempt.settledAt ?? attempt.attemptedAt));
  // A captured remote attempt and its local receipt describe one effect.
  return [...new Set(times)];
}

function normalizedPostingRule(source: string): string {
  const words: Readonly<Record<string, number>> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
    thirteen: 13,
    fourteen: 14,
    fifteen: 15,
    sixteen: 16,
    seventeen: 17,
    eighteen: 18,
    nineteen: 19,
    twenty: 20,
    thirty: 30,
    forty: 40,
    fifty: 50,
    sixty: 60,
    seventy: 70,
    eighty: 80,
    ninety: 90,
  };
  if (/\b(?:hundred|thousand|million|billion|dozen)\b/i.test(source))
    throw new Error("Unsupported compound posting interval");
  const quote = source
    .toLowerCase()
    .replaceAll("-", " ")
    .replaceAll(
      /\b(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\s+(?:one|two|three|four|five|six|seven|eight|nine)\b/g,
      (value) =>
        String(
          value.split(/\s+/u).reduce((sum, word) => {
            const number = words[word];
            if (number === undefined)
              throw new Error("Unknown number word in posting interval");
            return sum + number;
          }, 0),
        ),
    )
    .replaceAll(/\b[a-z]+\b/g, (word) =>
      words[word] === undefined ? word : String(words[word]),
    );
  for (const match of quote.matchAll(
    /\b([a-z]+|\d+)\s+\d+\s+(?:minute|hour|day|week)s?\b/g,
  )) {
    if (
      !/^(?:every|per|each|a|an|after|before|within|least|minimum|maximum|than|for|in|of|wait|bump|post|past|next|last|at)$/u.test(
        match[1] ?? "",
      )
    )
      throw new Error("Unrecognized quantity in posting interval");
  }
  return quote;
}

/** The model cannot loosen an explicitly quoted numeric interval. */
function assertObservedPostingPolicy(preflight: PromotionPreflight): void {
  const quote = normalizedPostingRule(preflight.ruleQuote);
  const units: Readonly<Record<string, number>> = {
    minute: 60,
    hour: 3600,
    day: 86_400,
    week: 604_800,
  };
  const durations = [...quote.matchAll(/\b(minute|hour|day|week)s?\b/g)].map(
    (match) => {
      const unit = match[1];
      const seconds = unit === undefined ? undefined : units[unit];
      if (seconds === undefined)
        throw new Error("Unknown posting interval unit");
      const quantity =
        (/(?:^|\s)(\S+)$/u.exec(quote
          .slice(0, match.index)
          .trimEnd()))?.[1] ?? "";
      if (/^(?:a|an|per|each|every)$/u.test(quantity)) return seconds;
      if (
        !/^\d+$/u.test(quantity) ||
        !Number.isSafeInteger(Number(quantity)) ||
        Number(quantity) <= 0
      )
        throw new Error("Unsupported posting interval quantity");
      return Number(quantity) * seconds;
    },
  );
  if (/\bdaily\b/.test(quote)) durations.push(86_400);
  if (/\bweekly\b/.test(quote)) durations.push(604_800);
  if (durations.length === 0)
    throw new Error(
      "Rule evidence must establish an explicit posting interval",
    );
  if (preflight.policy.maxActions > 1)
    throw new Error("This executor supports one action per posting window");
  const strictest = Math.max(...durations);
  if (preflight.policy.kind === "rolling") {
    if (preflight.policy.windowSeconds < strictest)
      throw new Error("Policy is less restrictive than the captured rule");
    return;
  }
  if (
    strictest > 86_400 ||
    !/\b(?:calendar|midnight|reset)\b/.test(quote) ||
    !quote.includes(preflight.policy.timezone.toLowerCase())
  )
    throw new Error(
      "Calendar policy requires an explicit quoted reset, timezone and daily interval",
    );
}

function eligibilityDeadline(
  input: PromotionEligibilityInput,
  uniqueTimes: readonly number[],
): number {
  const { target, state, preflight, now } = input;
  const last = Math.max(0, ...uniqueTimes);
  const siteDeadline =
    preflight.nextAllowedAt === null ? 0 : Date.parse(preflight.nextAllowedAt);
  const boundary = Math.max(
    policyEligibleAt(preflight.policy, uniqueTimes, now),
    last === 0 ? 0 : last + target.minimumIntervalSeconds * 1000,
    siteDeadline,
  );
  const initialBuffer =
    state.checkedAt === null ? now + state.bufferSeconds * 1000 : 0;
  return Math.max(
    initialBuffer,
    boundary === 0 ? 0 : boundary + state.bufferSeconds * 1000,
    state.nextEligibleAt === null ? 0 : Date.parse(state.nextEligibleAt),
  );
}

function eligibilityReason(
  input: PromotionEligibilityInput,
  due: number,
): string | null {
  const { target, state, preflight, now } = input;
  const restrictions: readonly (readonly [boolean, string])[] = [
    [state.paused, "Target paused"],
    [target.action === "pending", "Listing prerequisites unresolved"],
    [
      state.attempts.some((attempt) => attempt.status === "uncertain"),
      "Previous submission requires reconciliation",
    ],
    [!preflight.historyComplete, "Posting history is incomplete"],
    [
      preflight.equivalentPostExists,
      "Equivalent active submission already exists",
    ],
    [target.action === "news", "No approved substantive news"],
    [now < due, "Cooldown and buffer have not expired"],
  ];
  return restrictions.find(([blocked]) => blocked)?.[1] ?? null;
}

export function promotionEligibility(input: PromotionEligibilityInput): {
  allowed: boolean;
  nextEligibleAt: string;
  reason: string | null;
} {
  const due = eligibilityDeadline(input, evidenceActionTimes(input));
  const reason = eligibilityReason(input, due);
  return {
    allowed: reason === null,
    nextEligibleAt: new Date(Math.max(input.now, due)).toISOString(),
    reason,
  };
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
      state.attempts.map((attempt) =>
        Date.parse(attempt.settledAt ?? attempt.attemptedAt),
      ),
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
