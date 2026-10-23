import { useEffect, useId, useRef, useState } from "react";
import { useSelector } from "@tanstack/react-form";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowUp, ImagePlus, Square } from "lucide-react";
import type { ExploreMentionCandidate } from "@scout-for-lol/data";
import { Button } from "@scout-for-lol/design-system/components/button";
import { ExploreMentionPicker } from "#src/components/explore/transcript/explore-mention-picker.tsx";
import { useDebouncedValue } from "#src/hooks/use-debounced-value.ts";
import {
  activeMentionSpan,
  applyMention,
  mergeMentionCandidates,
  staticMentionCandidates,
} from "#src/lib/explore/explore-mentions.ts";
import { useTRPC } from "#src/lib/query/trpc.ts";
import {
  focusFirstInvalid,
  handleFormSubmit,
  submitThenChangeValidation,
  useScoutForm,
} from "#src/components/semantic-form.tsx";
import { ExploreQuestionFormSchema } from "#src/lib/form-schemas.ts";
import {
  ComposerImageStrip,
  useComposerImages,
} from "#src/components/explore/explore-composer-images.tsx";
import {
  EXPLORE_IMAGE_ACCEPT,
  imageFiles,
} from "#src/lib/explore/explore-attachments.ts";

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
  /** The question, and the ids of the images uploaded with it. */
  /** Resolves true once the question was accepted. */
  onAsk: (
    question: string,
    attachmentIds: readonly string[],
  ) => Promise<boolean>;
  onStop: () => void;
}) {
  const { active, disabled = false, restoredDraft, onAsk, onStop } = props;
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const formElement = useRef<HTMLFormElement>(null);
  const wasActiveRef = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const images = useComposerImages();
  const form = useScoutForm({
    defaultValues: { question: "" },
    validationLogic: submitThenChangeValidation,
    validators: { onDynamic: ExploreQuestionFormSchema },
    onSubmit: ({ value }) => {
      if (active || disabled || images.uploading || images.failed) return;
      const parsed = ExploreQuestionFormSchema.parse(value);
      const attachmentIds = images.readyIds;
      form.reset({ question: "" });
      // The images stay until the question is accepted: a refused start
      // (rate limit, busy conversation, outage) keeps them for the retry.
      void (async () => {
        if (await onAsk(parsed.question, attachmentIds))
          images.release(attachmentIds);
      })();
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
  // Player results are dropped while they belong to an older query: the
  // debounce leaves `debouncedQuery` behind for 250ms and `keepPreviousData`
  // keeps serving the previous response after that, so merging them
  // unconditionally let the picker highlight — and insert — a player unrelated
  // to the text currently after the `@`. The static catalogs are derived from
  // `rawQuery` and are always current, so the list does not go empty.
  const playersAreCurrent =
    rawQuery === debouncedQuery && !playerSearch.isPlaceholderData;
  const candidates = open
    ? mergeMentionCandidates(
        playersAreCurrent ? (playerSearch.data ?? []) : [],
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

  // Screenshots arrive by paste or drop as often as by the picker. Native
  // listeners on the form: a paste lands in the textarea and bubbles here, and
  // a drop anywhere on the composer counts.
  const acceptingImages = !active && !disabled;
  const addImages = images.add;
  useEffect(() => {
    const element = formElement.current;
    if (element === null) return;
    const onPaste = (event: ClipboardEvent): void => {
      const pasted = imageFiles(event.clipboardData?.files ?? []);
      if (!acceptingImages || pasted.length === 0) return;
      event.preventDefault();
      addImages(pasted);
    };
    const carriesFiles = (event: DragEvent): boolean =>
      event.dataTransfer?.types.includes("Files") === true;
    const onDragOver = (event: DragEvent): void => {
      if (carriesFiles(event)) event.preventDefault();
    };
    const onDrop = (event: DragEvent): void => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      if (acceptingImages)
        addImages(imageFiles(event.dataTransfer?.files ?? []));
    };
    element.addEventListener("paste", onPaste);
    element.addEventListener("dragover", onDragOver);
    element.addEventListener("drop", onDrop);
    return () => {
      element.removeEventListener("paste", onPaste);
      element.removeEventListener("dragover", onDragOver);
      element.removeEventListener("drop", onDrop);
    };
  }, [acceptingImages, addImages]);

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
        className="relative flex w-full flex-col rounded-2xl border border-scout-border bg-scout-surface p-1.5 pl-3.5 shadow-sm transition-all focus-within:border-scout-primary focus-within:ring-1 focus-within:ring-scout-primary"
        aria-busy={active}
        onSubmit={(event) => {
          handleFormSubmit(event, () => form.handleSubmit());
        }}
      >
        <ComposerImageStrip
          images={images.images}
          notice={images.notice}
          onRemove={images.remove}
        />
        <div className="flex w-full items-end gap-2">
          <ExploreMentionPicker
            id={listId}
            candidates={candidates}
            activeIndex={activeIndex}
            loading={playerSearch.isFetching}
            optionId={optionId}
            onSelect={choose}
          />
          {/*
          The combobox wrapper, rather than the textarea itself: ARIA allows
          `role="combobox"` on a single-line input, not on a textarea, and
          `aria-expanded` is not supported on the textarea's implicit `textbox`
          either. Naming the container instead keeps the whole pattern legal —
          the container owns the expanded state and points at the listbox,
          while the textarea keeps the two attributes a textbox does support,
          `aria-autocomplete` and `aria-activedescendant`.
        */}
          <div
            className="min-w-0 flex-1"
            role="combobox"
            aria-label="Question"
            aria-expanded={open && candidates.length > 0}
            aria-controls={listId}
          >
            <form.AppField name="question">
              {(field) => (
                <field.TextareaField
                  id="explore-question"
                  label={<span className="sr-only">Question</span>}
                  fieldClassName="min-w-0 py-1 !gap-0"
                  ref={textareaRef}
                  rows={1}
                  maxLength={2000}
                  className="max-h-[200px] !min-h-[24px] w-full !resize-none !border-0 !bg-transparent !p-0 text-sm sm:text-base leading-6 !shadow-none !outline-none focus:!border-0 focus:!outline-none focus:!ring-0 focus-visible:!ring-0"
                  onKeyDown={(event) => {
                    // Committing an IME candidate fires Enter with isComposing
                    // set; sending then would submit half-converted text.
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
          </div>

          <div className="flex shrink-0 items-center gap-1 pb-0.5">
            {!active && (
              <>
                <input
                  ref={fileInput}
                  type="file"
                  accept={EXPLORE_IMAGE_ACCEPT}
                  multiple
                  className="sr-only"
                  tabIndex={-1}
                  aria-hidden="true"
                  onChange={(event) => {
                    images.add([...(event.currentTarget.files ?? [])]);
                    event.currentTarget.value = "";
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="size-8 !rounded-full text-scout-subtle hover:bg-scout-hover"
                  aria-label="Attach an image"
                  title="Attach an image (or paste one)"
                  disabled={disabled}
                  onClick={() => fileInput.current?.click()}
                >
                  <ImagePlus className="size-4" />
                </Button>
              </>
            )}
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
                disabled={
                  disabled ||
                  images.uploading ||
                  images.failed ||
                  question.trim().length === 0
                }
                aria-label="Send question"
                title="Send"
              >
                <ArrowUp className="size-4" />
              </Button>
            )}
          </div>
        </div>
      </form>
    </form.AppForm>
  );
}
