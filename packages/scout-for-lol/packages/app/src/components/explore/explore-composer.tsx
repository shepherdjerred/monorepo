import { useEffect, useRef } from "react";
import { useSelector } from "@tanstack/react-form";
import { ArrowUp, Square } from "lucide-react";
import { Button } from "@scout-for-lol/design-system/components/button";
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
        className="flex w-full items-end gap-2 rounded-2xl border border-scout-border bg-scout-surface p-1.5 pl-3.5 shadow-sm transition-all focus-within:border-scout-primary focus-within:ring-1 focus-within:ring-scout-primary"
        aria-busy={active}
        onSubmit={(event) => {
          handleFormSubmit(event, () => form.handleSubmit());
        }}
      >
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
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
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
