import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { MessageSquare } from "lucide-react";
import { useTRPC } from "#src/lib/trpc.ts";
import { SESSION_QUERY_OPTIONS } from "#src/lib/session-query.ts";
import { track } from "#src/lib/analytics.ts";
import {
  isFeedbackDismissed,
  markFeedbackDismissed,
  markFeedbackSubmitted,
} from "#src/lib/feedback-storage.ts";
import { STALE_TIME_SLOW_LIST } from "#src/lib/stale-times.ts";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@scout-for-lol/design-system/components/dialog";
import {
  DialogFormError,
  DialogFormFooter,
} from "#src/components/dialog-form.tsx";
import {
  focusFirstInvalid,
  FormPendingStatus,
  handleFormSubmit,
  submitThenChangeValidation,
  useScoutForm,
} from "#src/components/semantic-form.tsx";
import { FeedbackFormSchema } from "#src/lib/form-schemas.ts";

/** Days a user must have been signed up before we ask anything. */
const MIN_ACCOUNT_AGE_DAYS = 7;

/**
 * A dismissible in-app feedback prompt.
 *
 * This exists because every other feedback channel was structurally broken: the
 * post-removal DM cannot be delivered once the bot is kicked (1 delivery in 15
 * attempts), and the surviving DM ask ends in "message a human", which nothing
 * records. A signed-in user in the dashboard is reachable and has somewhere to
 * type, so this is the one channel with no delivery problem at all.
 *
 * Shown at most once per user: dismissing or submitting silences it forever,
 * mirroring the DM message budget. Deliberately not offered in-channel.
 */
export function FeedbackPrompt() {
  const trpc = useTRPC();
  const session = useQuery(
    trpc.auth.sessionState.queryOptions(undefined, SESSION_QUERY_OPTIONS),
  );
  const user = session.data?.user ?? null;

  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const formElement = useRef<HTMLFormElement>(null);

  const submit = useMutation(
    trpc.feedback.submit.mutationOptions({
      onSuccess: () => {
        if (user !== null) markFeedbackSubmitted(user.discordId);
        track("feedback_submitted");
        setOpen(false);
        setHidden(true);
      },
      onError: (mutationError) => {
        setError(mutationError.message);
      },
    }),
  );

  const dismissMutation = useMutation(
    trpc.feedback.dismiss.mutationOptions({
      retry: 2,
      onSuccess: () => {
        // Only remember locally once the server has it. Recording the dismissal
        // in localStorage regardless meant a failed write left the account
        // eligible forever while THIS browser never asked again — so another
        // device kept showing the supposedly one-time prompt.
        if (user !== null) markFeedbackDismissed(user.discordId);
      },
      onError: () => {
        // Surface it again rather than silently losing the dismissal; the next
        // attempt (or the next page load) retries against a still-eligible
        // account, keeping every device consistent.
        setHidden(false);
      },
    }),
  );

  const form = useScoutForm({
    defaultValues: { body: "" },
    validationLogic: submitThenChangeValidation,
    validators: { onDynamic: FeedbackFormSchema },
    onSubmit: ({ value }) => {
      setError(null);
      submit.mutate(FeedbackFormSchema.parse(value));
    },
    onSubmitInvalid: () => {
      focusFirstInvalid(formElement.current);
    },
  });

  // Only ask people who have actually used Scout — i.e. created a subscription.
  // Merely being able to manage a guild where Scout is installed proves
  // nothing: that person may never have configured it, and asking them would
  // both pollute the sample and burn their one-time prompt. That population
  // gets the onboarding ladder instead.
  //
  // `enabled` matters: this component is mounted globally, including on
  // /login, so an unconditional authenticated query would manufacture exactly
  // the UNAUTHORIZED errors `sessionState` exists to eliminate.
  const eligibility = useQuery(
    trpc.feedback.eligibility.queryOptions(undefined, {
      enabled: user !== null,
      retry: false,
      staleTime: STALE_TIME_SLOW_LIST,
    }),
  );

  if (user === null || hidden) return null;
  if (isFeedbackDismissed(user.discordId)) return null;
  if (eligibility.data?.shouldAsk !== true) return null;

  const accountAgeDays =
    (Date.now() - new Date(user.createdAt).getTime()) / 86_400_000;
  if (accountAgeDays < MIN_ACCOUNT_AGE_DAYS) return null;

  const dismiss = () => {
    // Hide optimistically for responsiveness; the local flag and the permanent
    // hide are only committed once the server write succeeds.
    track("feedback_dismissed");
    setHidden(true);
    dismissMutation.mutate();
  };

  return (
    <>
      <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full border border-border bg-scout-surface px-3 py-1.5 text-xs text-scout-subtle shadow-md">
        <MessageSquare className="h-3.5 w-3.5 shrink-0" />
        <span>How&apos;s Scout working out?</span>
        <button
          type="button"
          className="font-medium text-scout-ink underline-offset-2 hover:underline"
          onClick={() => {
            track("feedback_shown");
            setOpen(true);
          }}
        >
          Tell us
        </button>
        <button
          type="button"
          aria-label="Dismiss"
          className="text-sm leading-none text-scout-subtle hover:text-scout-ink"
          onClick={dismiss}
        >
          ×
        </button>
      </div>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setError(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>How&apos;s Scout working out?</DialogTitle>
            <DialogDescription>
              Anything broken, confusing, or missing? We read everything.
              We&apos;ll only ask you this once.
            </DialogDescription>
          </DialogHeader>
          <form
            ref={formElement}
            onSubmit={(event) => {
              handleFormSubmit(event, () => form.handleSubmit());
            }}
            className="space-y-4"
            aria-busy={submit.isPending}
          >
            <form.AppForm>
              <fieldset
                disabled={submit.isPending}
                className="m-0 border-0 p-0"
              >
                <form.AppField name="body">
                  {(field) => (
                    <field.TextareaField
                      id="feedback-body"
                      label="Your feedback"
                      rows={5}
                      maxLength={4000}
                      placeholder="What's working, what isn't, what you wish it did…"
                      autoComplete="off"
                      required
                    />
                  )}
                </form.AppField>
              </fieldset>
              <DialogFormError error={error} />
              <FormPendingStatus pending={submit.isPending}>
                Sending feedback…
              </FormPendingStatus>
              <DialogFormFooter
                onCancel={() => {
                  setError(null);
                  form.reset({ body: "" });
                  setOpen(false);
                }}
                pending={submit.isPending}
                submitLabel="Send feedback"
                pendingLabel="Sending…"
              />
            </form.AppForm>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
