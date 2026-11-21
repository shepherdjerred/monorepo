import { z } from "zod/v4";
import type { PromotionStore } from "#activities/promotion/store.ts";
import { RedditBrowserReadError } from "#activities/promotion/reddit-discovery/browser-reader.ts";

export const RedditAccountStateSchema = z.strictObject({
  owner: z.string().nullable(),
  consecutiveRateLimits: z.number().int().nonnegative().default(0),
  retryAt: z.iso.datetime().nullable().default(null),
  hold: z.enum(["challenge", "logged-out"]).nullable().default(null),
  lastFailureAt: z.iso.datetime().nullable().default(null),
});
const ACCOUNT_KEY = "reddit-outreach/account.json";
type AccountState = z.infer<typeof RedditAccountStateSchema>;
export type RedditAccountFailure = {
  kind: "rate-limit" | "challenge" | "logged-out";
  retryAt?: string | null;
};
const recordedErrors = new WeakSet<object>();

export class RedditAccountBusy extends Error {}
export class RedditAccountUnavailable extends RedditAccountBusy {
  readonly kind: RedditAccountFailure["kind"];
  readonly retryAt: string | null;
  constructor(kind: RedditAccountFailure["kind"], retryAt: string | null) {
    super(
      kind === "rate-limit"
        ? `Reddit account cooldown is active until ${retryAt ?? "its retry deadline"}`
        : `Reddit account requires operator restoration: ${kind}`,
    );
    this.name = "RedditAccountUnavailable";
    this.kind = kind;
    this.retryAt = retryAt;
  }
}

const INITIAL: AccountState = {
  owner: null,
  consecutiveRateLimits: 0,
  retryAt: null,
  hold: null,
  lastFailureAt: null,
};

export async function readRedditPromotionAccount(store: PromotionStore) {
  const account = await store.read(ACCOUNT_KEY, RedditAccountStateSchema);
  return account?.value ?? { ...INITIAL };
}

export function assertRedditPromotionAccountAvailable(
  state: AccountState,
  now = Date.now(),
) {
  if (state.hold !== null) throw new RedditAccountUnavailable(state.hold, null);
  if (state.retryAt !== null && Date.parse(state.retryAt) > now)
    throw new RedditAccountUnavailable("rate-limit", state.retryAt);
}

async function updateAccount(
  store: PromotionStore,
  change: (state: AccountState) => AccountState,
) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await store.read(ACCOUNT_KEY, RedditAccountStateSchema);
    const next = RedditAccountStateSchema.parse(
      change(current?.value ?? { ...INITIAL }),
    );
    if (await store.put(ACCOUNT_KEY, next, current?.etag)) return next;
  }
  throw new Error("Concurrent Reddit account state update did not settle");
}

export async function recordRedditAccountFailure(
  store: PromotionStore,
  failure: RedditAccountFailure,
  now = Date.now(),
) {
  return await updateAccount(store, (state) => {
    if (failure.kind !== "rate-limit")
      return {
        ...state,
        hold: failure.kind,
        lastFailureAt: new Date(now).toISOString(),
      };
    const count = state.consecutiveRateLimits + 1;
    const exposed =
      failure.retryAt == null ? Number.NaN : Date.parse(failure.retryAt);
    const deadline =
      Number.isFinite(exposed) && exposed > now
        ? exposed
        : now + Math.min(6 * 60, 30 * 2 ** Math.min(count - 1, 4)) * 60_000;
    const previous = state.retryAt === null ? 0 : Date.parse(state.retryAt);
    return {
      ...state,
      consecutiveRateLimits: count,
      retryAt: new Date(Math.max(previous, deadline)).toISOString(),
      lastFailureAt: new Date(now).toISOString(),
    };
  });
}

/** A successful read cannot erase an active deadline or an operator-only hold. */
export async function recordRedditAccountSuccess(
  store: PromotionStore,
  now = Date.now(),
) {
  return await updateAccount(store, (state) =>
    state.hold !== null ||
    (state.retryAt !== null && Date.parse(state.retryAt) > now)
      ? state
      : { ...state, consecutiveRateLimits: 0, retryAt: null },
  );
}

export function markRedditAccountFailureRecorded(error: object) {
  recordedErrors.add(error);
}

export async function recordRedditAccountError(
  store: PromotionStore,
  error: unknown,
  now = Date.now(),
) {
  if (!(error instanceof RedditBrowserReadError) || recordedErrors.has(error))
    return;
  if (error.kind === "page" || error.kind === "cursor") return;
  await recordRedditAccountFailure(
    store,
    {
      kind: error.kind === "identity" ? "logged-out" : error.kind,
      retryAt: error.retryAt,
    },
    now,
  );
  recordedErrors.add(error);
}

/** A lost worker leaves the account held until its execution is inspected. */
export async function withRedditPromotionAccount<T>(
  store: PromotionStore,
  owner: string,
  task: () => Promise<T>,
): Promise<T> {
  const current = await store.read(ACCOUNT_KEY, RedditAccountStateSchema);
  assertRedditPromotionAccountAvailable(current?.value ?? INITIAL);
  if (current?.value.owner !== undefined && current.value.owner !== null)
    throw new RedditAccountBusy(
      "The Reddit promotion account is already owned",
    );
  if (
    !(await store.put(
      ACCOUNT_KEY,
      { ...(current?.value ?? INITIAL), owner },
      current?.etag,
    ))
  )
    throw new RedditAccountBusy(
      "The Reddit promotion account was claimed concurrently",
    );
  try {
    return await task();
  } catch (error) {
    await recordRedditAccountError(store, error);
    throw error;
  } finally {
    await releaseRedditPromotionAccount(store, owner);
  }
}

async function releaseRedditPromotionAccount(
  store: PromotionStore,
  owner: string,
) {
  await updateAccount(store, (held) => {
    if (held.owner !== owner)
      throw new Error("Reddit account ownership changed during execution");
    return { ...held, owner: null };
  });
}

/** Restore only after an operator repairs the session and a read verifies it. */
export async function restoreRedditPromotionAccount(input: {
  store: PromotionStore;
  owner: string;
  reason: string;
  verify: () => Promise<void>;
  now?: () => number;
}) {
  const reason = z.string().trim().min(10).max(1000).parse(input.reason);
  const owner = z.string().min(1).parse(input.owner);
  const now = input.now ?? Date.now;
  const previous = await updateAccount(input.store, (state) => {
    if (state.owner !== null)
      throw new RedditAccountBusy(
        "Cannot restore an actively owned Reddit account",
      );
    if (state.retryAt !== null && Date.parse(state.retryAt) > now())
      throw new RedditAccountUnavailable("rate-limit", state.retryAt);
    return { ...state, owner };
  });
  try {
    await input.verify();
    const audit = {
      owner,
      reason,
      observedAt: new Date(now()).toISOString(),
      previousHold: previous.hold,
      previousRetryAt: previous.retryAt,
      account: "the_storm_mc",
    };
    if (
      !(await input.store.put(
        `reddit-outreach/account-restorations/${encodeURIComponent(owner)}.json`,
        audit,
        undefined,
      ))
    )
      throw new Error("Reddit restoration audit already exists");
    return await updateAccount(input.store, (state) => {
      if (state.owner !== owner)
        throw new Error("Reddit restoration lost account ownership");
      if (state.retryAt !== null && Date.parse(state.retryAt) > now())
        throw new RedditAccountUnavailable("rate-limit", state.retryAt);
      return { ...state, hold: null, retryAt: null, consecutiveRateLimits: 0 };
    });
  } catch (error) {
    await recordRedditAccountError(input.store, error, now());
    throw error;
  } finally {
    await releaseRedditPromotionAccount(input.store, owner);
  }
}
