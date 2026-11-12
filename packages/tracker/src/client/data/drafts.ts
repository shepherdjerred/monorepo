import { z } from "zod";
import { PendingSchema, carries, type Pending } from "./pending-drafts.ts";

const prefix = "tracker.draft.";
const pendingPrefix = "tracker.pending.";
const DraftSchema = z.object({
  text: z.string(),
  attachments: z.array(z.string()),
});
export type Draft = z.infer<typeof DraftSchema>;
type DraftStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem" | "key" | "length"
>;

type Sent = { ok: true } | { ok: false; error: unknown };
/** A failure the server answered with: it refused, and saved nothing. */
const AnsweredSchema = z.object({ data: z.object({ code: z.string() }) });
/** Which editor is sending, so the send can be recognised after a reload. */
export type SendMark = Pick<Pending, "kind" | "subject">;

/**
 * Unsent text, kept per form for the life of the tab. Only text that differs
 * from what the form started with is stored, so "is anything stored" is the
 * same question as "would closing the tab lose work".
 *
 * Text that has been sent is kept apart as pending until the server answers.
 * A request that fails without an answer, because the page unloaded under it
 * or the connection dropped, may still have been saved, so its text stays
 * pending for the editor to settle against what the server holds.
 */
export function createDrafts(
  storage: () => DraftStorage,
  now: () => number = Date.now,
) {
  function write(key: string, draft: Draft, baseline: string) {
    if (draft.text === baseline && draft.attachments.length === 0) {
      storage().removeItem(prefix + key);
      return;
    }
    storage().setItem(prefix + key, JSON.stringify(draft));
  }
  function pending(key: string): Pending | undefined {
    const saved = storage().getItem(pendingPrefix + key);
    return saved === null ? undefined : PendingSchema.parse(JSON.parse(saved));
  }
  return {
    read(key: string): Draft | undefined {
      const saved = storage().getItem(prefix + key);
      return saved === null ? undefined : DraftSchema.parse(JSON.parse(saved));
    },
    /** Store a draft, or forget it once it matches `baseline` again. */
    write(key: string, draft: Draft, baseline = "") {
      write(key, draft, baseline);
    },
    /** Text that was sent from this form and never answered. */
    pending,
    /**
     * Send a draft. It stops being a draft the moment it is sent, so a reload
     * while the request is in flight cannot offer text that was posted, and
     * is kept as pending instead. Success forgets it and a refusal makes it
     * a draft again; a send that got no answer at all stays pending.
     */
    async send<T extends Sent>(
      key: string,
      draft: Draft,
      options: { baseline: string; mark: SendMark; run: () => Promise<T> },
    ) {
      const store = storage();
      store.removeItem(prefix + key);
      if (draft.text !== options.baseline || draft.attachments.length > 0) {
        const sent: Pending = {
          ...options.mark,
          ...draft,
          sentAt: now(),
        };
        store.setItem(pendingPrefix + key, JSON.stringify(sent));
      }
      const outcome = await options.run();
      if (outcome.ok) {
        store.removeItem(pendingPrefix + key);
        return { outcome, fate: "saved" } as const;
      }
      if (!AnsweredSchema.safeParse(outcome.error).success) {
        return { outcome, fate: "unknown" } as const;
      }
      store.removeItem(pendingPrefix + key);
      write(key, draft, options.baseline);
      return { outcome, fate: "refused" } as const;
    },
    /**
     * Settle a pending send once its editor knows what the server holds:
     * forget text that was saved, or make text that was not a draft again.
     */
    settle(key: string, decision: "drop" | "restore", baseline = "") {
      const sent = pending(key);
      storage().removeItem(pendingPrefix + key);
      if (sent === undefined || decision === "drop") {
        return;
      }
      const draft = { text: sent.text, attachments: sent.attachments };
      write(key, draft, baseline);
      return draft;
    },
    /** Record the request ID of the HTTP request carrying pending sends. */
    stamp(calls: { path: string; input: unknown }[], requestId: string) {
      const store = storage();
      for (let index = 0; index < store.length; index += 1) {
        const name = store.key(index);
        if (name?.startsWith(pendingPrefix) !== true) {
          continue;
        }
        const sent = pending(name.slice(pendingPrefix.length));
        if (
          sent !== undefined &&
          sent.requestId === undefined &&
          calls.some((call) => carries(sent, call))
        ) {
          store.setItem(name, JSON.stringify({ ...sent, requestId }));
        }
      }
    },
    /** Forget a form's draft and anything it sent that was never answered. */
    clear(key: string) {
      storage().removeItem(prefix + key);
      storage().removeItem(pendingPrefix + key);
    },
    /** True while any form holds text that has not been sent or discarded. */
    dirty() {
      const store = storage();
      for (let index = 0; index < store.length; index += 1) {
        if (store.key(index)?.startsWith(prefix) === true) {
          return true;
        }
      }
      return false;
    },
  };
}

export const drafts = createDrafts(() => sessionStorage);
