import { useEffect, useId, useRef, useState } from "react";
import { useSelector } from "@tanstack/react-form";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowUp, Square } from "lucide-react";
import type { ExploreMentionCandidate } from "@scout-for-lol/data";
import { Button } from "@scout-for-lol/design-system/components/button";
import { ExploreMentionPicker } from "#src/components/explore-mention-picker.tsx";
import { useDebouncedValue } from "#src/hooks/use-debounced-value.ts";
import {
  activeMentionSpan,
  applyMention,
  mergeMentionCandidates,
  staticMentionCandidates,
} from "#src/lib/explore-mentions.ts";
import { useTRPC } from "#src/lib/trpc.ts";
import {
  focusFirstInvalid,
  handleFormSubmit,
  submitThenChangeValidation,
  useScoutForm,
} from "#src/components/semantic-form.tsx";
import { ExploreQuestionFormSchema } from "#src/lib/form-schemas.ts";

/**
 * Keep in step with the `max-h-[200px]` class below — Tailwind cannot
 * interpolate a constant into a class name, so the ceiling lives twice.
 */
const MAX_COMPOSER_HEIGHT_PX = 200;

/** Enough to choose from without the popover becoming its own scroll region. */
const MAX_MENTION_SUGGESTIONS = 8;

/**
 * The ask box. Owns its own draft so keystrokes re-render this leaf, not the
 * page (and with it the whole transcript).
 */
export function ExploreComposer(props: {
  /** True while a turn is streaming — disables input, swaps Ask for Stop. */
  active: boolean;
  /** Temporarily prevents submission without presenting a Stop action. */
  disabled?: boolean;
  /** Question handed back by a failed turn, adopted into an empty box. */
  restoredDraft: string | null;
  onAsk: (question: string) => void;
  onStop: () => void;
}) {
  const { active, disabled = false, restoredDraft, onAsk, onStop } = props;
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const formElement = useRef<HTMLFormElement>(null);
  const wasActiveRef = useRef(false);
  const form = useScoutForm({
    defaultValues: { question: "" },
    validationLogic: submitThenChangeValidation,
    validators: { onDynamic: ExploreQuestionFormSchema },
    onSubmit: ({ value }) => {
      if (active || disabled) return;
      const parsed = ExploreQuestionFormSchema.parse(value);
      form.reset({ question: "" });
      onAsk(parsed.question);
    },
    onSubmitInvalid: () => {
      focusFirstInvalid(formElement.current);
    },
  });
  const question = useSelector(form.store, (state) => state.values.question);

  // ── `@` mentions ────────────────────────────────────────────────────────
  // The picker exists because `player('…')` refuses an ambiguous name outright
  // and the model otherwise burns a `resolve_player` round trip guessing.
  // Choosing from the list inserts a form that resolves to exactly one person.
  const trpc = useTRPC();
  const listId = useId();
  const optionId = (index: number): string =>
    `${listId}-option-${String(index)}`;
  const [caret, setCaret] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const span = active || disabled ? null : activeMentionSpan(question, caret);
  const rawQuery = span?.query ?? "";
  const open = span !== null && rawQuery.length > 0 && dismissed !== rawQuery;
  const debouncedQuery = useDebouncedValue(rawQuery);
  const playerSearch = useQuery(
    trpc.explore.searchPlayers.queryOptions(
      { query: debouncedQuery },
      {
        // Two characters before touching the lake: this is a DuckDB scan, not
        // a Postgres index lookup, and a single letter matches most of it.
        enabled: open && debouncedQuery.length >= 2,
        placeholderData: keepPreviousData,
      },
    ),
  );
  // Static catalogs answer on the first keystroke while the player lookup is
  // still in flight, so the list is never empty while it waits.
  const candidates = open
    ? mergeMentionCandidates(
        playerSearch.data ?? [],
        staticMentionCandidates(rawQuery),
        MAX_MENTION_SUGGESTIONS,
      )
    : [];

  // A narrowed query can leave the highlight past the end of a shorter list.
  useEffect(() => {
    setActiveIndex(0);
  }, [rawQuery]);

  const syncCaret = (element: HTMLTextAreaElement): void => {
    setCaret(element.selectionStart);
  };

  // Close the list when focus leaves the composer entirely. Done at the
  // document level rather than with an `onBlur` prop for two reasons:
  // `TextareaField` owns the field's own blur for validation, and focus moving
  // *within* the composer — which is what picking a row does — must not count
  // as leaving.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onFocusIn = (event: FocusEvent): void => {
      const target = event.target;
      if (
        target instanceof Node &&
        formElement.current?.contains(target) === true
      ) {
        return;
      }
      setDismissed(rawQuery);
    };
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [open, rawQuery]);

  /**
   * Keys the picker owns while it is open.
   *
   * Returns whether it handled the event. Enter matters most: with a
   * suggestion highlighted it means "take it", not "send a half-typed
   * question".
   */
  const handlePickerKey = (
    event: React.KeyboardEvent<HTMLTextAreaElement>,
  ): boolean => {
    if (!open || candidates.length === 0) {
      return false;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex(
        (current) => (current + step + candidates.length) % candidates.length,
      );
      return true;
    }
    if (event.key === "Escape") {
      // Dismiss this query only. Re-opening on the next keystroke would make
      // Escape useless; dismissing forever would make it unrecoverable
      // without deleting the `@`.
      event.preventDefault();
      setDismissed(rawQuery);
      return true;
    }
    if (event.key !== "Enter" && event.key !== "Tab") {
      return false;
    }
    const candidate = candidates[activeIndex];
    if (candidate === undefined) {
      return false;
    }
    event.preventDefault();
    choose(candidate);
    return true;
  };

  const choose = (candidate: ExploreMentionCandidate): void => {
    const textarea = textareaRef.current;
    if (span === null || textarea === null) return;
    const next = applyMention(question, span, candidate.insertText);
    form.setFieldValue("question", next.text);
    setDismissed(null);
    // The value lands on the next render, so the caret is placed after it —
    // otherwise the browser puts it at the end of the old text.
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(next.caret, next.caret);
      setCaret(next.caret);
    });
  };

  // Grow the composer with its content instead of scrolling a fixed box.
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea === null) {
      return;
    }
    textarea.style.minHeight = "24px";
    textarea.style.height = "auto";
    textarea.style.height = `${String(
      Math.min(textarea.scrollHeight, MAX_COMPOSER_HEIGHT_PX),
    )}px`;
  }, [question]);

  // Escape stops the turn. Window-level because the textarea is disabled
  // while a turn runs and a disabled control receives no keydown; the
  // `defaultPrevented` guard defers to Radix dialogs, whose own Escape
  // closes the dialog without also killing the turn.
  useEffect(() => {
    if (!active) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) {
        return;
      }
      if (event.key === "Escape") {
        onStop();
      }
    };
    globalThis.addEventListener("keydown", onKeyDown);
    return () => {
      globalThis.removeEventListener("keydown", onKeyDown);
    };
  }, [active, onStop]);

  // Disabling the textarea when a turn starts blurs it to the document body;
  // hand focus back when the turn ends so the next question needs no mouse.
  useEffect(() => {
    if (active) {
      wasActiveRef.current = true;
      return;
    }
    if (wasActiveRef.current) {
      wasActiveRef.current = false;
      textareaRef.current?.focus();
    }
  }, [active]);

  // Adopt a restored draft only into an empty box — a user who already
  // started retyping is never clobbered.
  useEffect(() => {
    if (restoredDraft === null) {
      return;
    }
    form.setFieldValue("question", (current) =>
      current.length === 0 ? restoredDraft : current,
    );
  }, [form, restoredDraft]);

  return (
    <form.AppForm>
      <form
        ref={formElement}
        className="relative flex w-full items-end gap-2 rounded-2xl border border-scout-border bg-scout-surface p-1.5 pl-3.5 shadow-sm transition-all focus-within:border-scout-primary focus-within:ring-1 focus-within:ring-scout-primary"
        aria-busy={active}
        onSubmit={(event) => {
          handleFormSubmit(event, () => form.handleSubmit());
        }}
      >
        <ExploreMentionPicker
          id={listId}
          candidates={candidates}
          activeIndex={activeIndex}
          loading={playerSearch.isFetching}
          optionId={optionId}
          onSelect={choose}
        />
        <form.AppField name="question">
          {(field) => (
            <field.TextareaField
              id="explore-question"
              label={<span className="sr-only">Question</span>}
              fieldClassName="min-w-0 flex-1 py-1 !gap-0"
              ref={textareaRef}
              rows={1}
              maxLength={2000}
              className="max-h-[200px] !min-h-[24px] w-full !resize-none !border-0 !bg-transparent !p-0 text-sm sm:text-base leading-6 !shadow-none !outline-none focus:!border-0 focus:!outline-none focus:!ring-0 focus-visible:!ring-0"
              onKeyDown={(event) => {
                // Committing an IME candidate fires Enter with isComposing set;
                // sending then would submit half-converted text.
                if (event.nativeEvent.isComposing) return;
                if (handlePickerKey(event)) return;
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              onKeyUp={(event) => {
                syncCaret(event.currentTarget);
              }}
              onClick={(event) => {
                syncCaret(event.currentTarget);
              }}
              role="combobox"
              aria-expanded={open && candidates.length > 0}
              aria-controls={listId}
              aria-autocomplete="list"
              {...(open && candidates.length > 0
                ? { "aria-activedescendant": optionId(activeIndex) }
                : {})}
              placeholder="Ask a question about match data…"
              autoComplete="off"
              disabled={active || disabled}
              required
            />
          )}
        </form.AppField>

        <div className="shrink-0 pb-0.5">
          {active ? (
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              className="size-8 !rounded-full border-scout-border hover:bg-scout-hover"
              title="Stop (Esc)"
              aria-label="Stop (Esc)"
              onClick={onStop}
            >
              <Square className="size-3.5 fill-current" />
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon-sm"
              className="size-8 !rounded-full bg-scout-primary text-scout-brand-ink transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
              disabled={disabled || question.trim().length === 0}
              aria-label="Send question"
              title="Send"
            >
              <ArrowUp className="size-4" />
            </Button>
          )}
        </div>
      </form>
    </form.AppForm>
  );
}
