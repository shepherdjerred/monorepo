import { useRef, useState } from "react";
import { drafts, type Draft, type SendMark } from "./drafts.ts";
import {
  mayStillLand,
  settleMs,
  settlePending,
  type Pending,
} from "./pending-drafts.ts";
import { notify } from "#client/ui/toast.tsx";

/** How a form recognises, after a reload, whether what it sent was saved. */
export type Reconcile = SendMark & {
  /**
   * Whether the server holds the pending text; undefined until the server's
   * copy has loaded.
   */
  saved: ((pending: Pending) => boolean) | undefined;
  /** Fetch the server's copy again, for a send that may still be landing. */
  recheck: () => Promise<unknown>;
  /** What to tell the reader when unsent text is put back. */
  notice?: string;
};

type State = {
  draft: Draft;
  /** Sent text whose fate is not known yet; the field waits on it. */
  held: Pending | undefined;
  /** The field holds text that was put back after an unanswered send. */
  restored: boolean;
};

/**
 * A text field whose unsent content survives navigation and reloads. `key`
 * names the form; `baseline` is the text it shows when nothing was typed.
 *
 * Text whose send got no answer, because the page unloaded or the connection
 * dropped, is neither shown nor lost: once the server's copy is known it is
 * dropped if it was saved and put back, with a notice, if it was not. It is
 * never sent again by itself.
 */
export function useDraft(key: string, baseline: string, reconcile: Reconcile) {
  const [, rerender] = useState(0);
  // A send made moments ago may still be on its way into the database.
  const landing = useRef(false);
  const [state, setState] = useState<State>(() => {
    const held = drafts.pending(key);
    if (held === undefined) {
      return {
        draft: drafts.read(key) ?? { text: baseline, attachments: [] },
        held,
        restored: false,
      };
    }
    if (mayStillLand(held, Date.now())) {
      landing.current = true;
      setTimeout(
        () => {
          void (async () => {
            await reconcile.recheck();
            landing.current = false;
            rerender((count) => count + 1);
          })();
        },
        settleMs - (Date.now() - held.sentAt),
      );
    }
    return {
      draft: { text: baseline, attachments: [] },
      held,
      restored: false,
    };
  });
  // An upload changes the text and the attachments in one event; each change
  // must build on the other rather than on the last render.
  const latest = useRef(state.draft);
  const noticed = useRef(false);
  if (state.held !== undefined) {
    const decision = settlePending(
      reconcile.saved?.(state.held),
      landing.current,
    );
    if (decision !== "wait") {
      const draft = drafts.settle(key, decision, baseline);
      const next = draft ?? { text: baseline, attachments: [] };
      latest.current = next;
      setState({ draft: next, held: undefined, restored: draft !== undefined });
      if (
        draft !== undefined &&
        reconcile.notice !== undefined &&
        !noticed.current
      ) {
        noticed.current = true;
        const { notice } = reconcile;
        // A toast is another component's state; raise it after this render.
        queueMicrotask(() => {
          notify(notice);
        });
      }
    }
  }
  function show(draft: Draft, restored = false) {
    latest.current = draft;
    setState({ draft, held: undefined, restored });
  }
  function save(change: (current: Draft) => Draft) {
    // Typing over text whose fate is being checked would lose one of them.
    if (state.held !== undefined) {
      return;
    }
    const next = change(latest.current);
    show(next, state.restored);
    drafts.write(key, next, baseline);
  }
  const { draft } = state;
  return {
    text: draft.text,
    attachments: draft.attachments,
    /** Whether this field restored or holds unsent content. */
    dirty: draft.text !== baseline || draft.attachments.length > 0,
    /** The field is waiting to learn whether what it last sent was saved. */
    checking: state.held !== undefined,
    /** Unsent text was just put back; an editor should open on it. */
    restored: state.restored,
    setText: (text: string) => {
      save((current) => ({ ...current, text }));
    },
    addAttachments: (ids: string[]) => {
      save((current) => ({
        ...current,
        attachments: [...current.attachments, ...ids],
      }));
    },
    /**
     * Send what the field holds. It stops being a draft at once and the
     * field shows `shown` while the request runs; only a refused send brings
     * the draft back, to the field and to storage.
     */
    send: async <T extends { ok: true } | { ok: false; error: unknown }>(
      run: (sent: Draft) => Promise<T>,
      shown = baseline,
    ) => {
      const sent = latest.current;
      const during = { text: shown, attachments: [] };
      show(during);
      const { outcome, fate } = await drafts.send(key, sent, {
        baseline,
        mark: { kind: reconcile.kind, subject: reconcile.subject },
        run: () => run(sent),
      });
      if (fate === "refused") {
        show(sent);
      }
      if (fate === "unknown") {
        // No answer came: it may be saved all the same. Look before deciding.
        landing.current = true;
        latest.current = during;
        setState({ draft: during, held: drafts.pending(key), restored: false });
        await reconcile.recheck();
        landing.current = false;
        rerender((count) => count + 1);
      }
      return outcome;
    },
    /** Forget the draft: after a successful submit or an explicit discard. */
    reset: (text = baseline) => {
      show({ text, attachments: [] });
      drafts.clear(key);
    },
  };
}
