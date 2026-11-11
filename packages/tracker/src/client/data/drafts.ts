import { useRef, useState } from "react";
import { z } from "zod";

const prefix = "tracker.draft.";
const DraftSchema = z.object({
  text: z.string(),
  attachments: z.array(z.string()),
});
export type Draft = z.infer<typeof DraftSchema>;
type DraftStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem" | "key" | "length"
>;

/**
 * Unsent text, kept per form for the life of the tab. Only text that differs
 * from what the form started with is stored, so "is anything stored" is the
 * same question as "would closing the tab lose work".
 */
export function createDrafts(storage: () => DraftStorage) {
  return {
    read(key: string): Draft | undefined {
      const saved = storage().getItem(prefix + key);
      return saved === null ? undefined : DraftSchema.parse(JSON.parse(saved));
    },
    /** Store a draft, or forget it once it matches `baseline` again. */
    write(key: string, draft: Draft, baseline = "") {
      if (draft.text === baseline && draft.attachments.length === 0) {
        storage().removeItem(prefix + key);
        return;
      }
      storage().setItem(prefix + key, JSON.stringify(draft));
    },
    clear(key: string) {
      storage().removeItem(prefix + key);
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

/**
 * A text field whose unsent content survives navigation and reloads. `key`
 * names the form; `baseline` is the text it shows when nothing was typed.
 */
export function useDraft(key: string, baseline = "") {
  const [draft, setDraft] = useState<Draft>(
    () => drafts.read(key) ?? { text: baseline, attachments: [] },
  );
  // An upload changes the text and the attachments in one event; each change
  // must build on the other rather than on the last render.
  const latest = useRef(draft);
  function save(change: (current: Draft) => Draft) {
    const next = change(latest.current);
    latest.current = next;
    setDraft(next);
    drafts.write(key, next, baseline);
  }
  return {
    text: draft.text,
    attachments: draft.attachments,
    /** Whether this field restored or holds unsent content. */
    dirty: draft.text !== baseline || draft.attachments.length > 0,
    setText: (text: string) => {
      save((current) => ({ ...current, text }));
    },
    addAttachments: (ids: string[]) => {
      save((current) => ({
        ...current,
        attachments: [...current.attachments, ...ids],
      }));
    },
    /** Put back a draft that was sent optimistically and then refused. */
    restore: (sent: Draft) => {
      save(() => sent);
    },
    /** Forget the draft: after a successful submit or an explicit discard. */
    reset: (text = baseline) => {
      const next = { text, attachments: [] };
      latest.current = next;
      setDraft(next);
      drafts.clear(key);
    },
  };
}
