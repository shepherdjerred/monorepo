import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { MessageSquare } from "lucide-react";
import { useTRPC } from "#src/lib/query/trpc.ts";
import { SESSION_QUERY_OPTIONS } from "#src/lib/query/session-query.ts";
import { track } from "#src/lib/analytics.ts";
import {
  isFeedbackDismissed,
  markFeedbackDismissed,
  markFeedbackSubmitted,
} from "#src/lib/feedback-storage.ts";
import { STALE_TIME_SLOW_LIST } from "#src/lib/query/stale-times.ts";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@scout-for-lol/design-system/components/overlays/dialog";
import { FeedbackForm } from "#src/components/feedback-form.tsx";

/** Days a user must have been signed up before we ask anything. */
const MIN_ACCOUNT_AGE_DAYS = 7;

/**
 * A dismissible in-app feedback prompt.
 *
 * Shown at most once per user: dismissing or submitting silences it forever,
 * mirroring the DM message budget. The permanent support page and bot DMs
 * remain available after dismissal.
 */
export function FeedbackPrompt() {
  const trpc = useTRPC();
  const session = useQuery(
    trpc.auth.sessionState.queryOptions(undefined, SESSION_QUERY_OPTIONS),
  );
  const user = session.data?.user ?? null;

  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const promptRef = useRef<HTMLDivElement>(null);
  const impressionRecorded = useRef(false);

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

  const eligible =
    user !== null &&
    !hidden &&
    !isFeedbackDismissed(user.discordId) &&
    eligibility.data?.shouldAsk === true &&
    (Date.now() - new Date(user.createdAt).getTime()) / 86_400_000 >=
      MIN_ACCOUNT_AGE_DAYS;
  useEffect(() => {
    if (!eligible || promptRef.current === null || impressionRecorded.current)
      return;
    let intersecting = false;
    const recordVisible = () => {
      if (
        intersecting &&
        document.visibilityState === "visible" &&
        !impressionRecorded.current
      ) {
        impressionRecorded.current = true;
        track("feedback_prompt_visible", { surface: "in-app-prompt" });
      }
    };
    const observer = new IntersectionObserver((entries) => {
      intersecting = entries.some((entry) => entry.isIntersecting);
      recordVisible();
    });
    document.addEventListener("visibilitychange", recordVisible);
    observer.observe(promptRef.current);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", recordVisible);
    };
  }, [eligible]);

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
      <div
        ref={promptRef}
        className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full border border-border bg-scout-surface px-3 py-1.5 text-xs text-scout-subtle shadow-md"
      >
        <MessageSquare className="h-3.5 w-3.5 shrink-0" />
        <span className="hidden sm:inline">How&apos;s Scout working out?</span>
        <button
          type="button"
          className="min-h-6 font-medium text-scout-ink underline-offset-2 hover:underline"
          aria-label="Tell us how Scout is working"
          onClick={() => {
            track("feedback_opened", { surface: "in-app-prompt" });
            setOpen(true);
          }}
        >
          Tell us
        </button>
        <button
          type="button"
          aria-label="Dismiss"
          className="size-6 shrink-0 text-sm leading-none text-scout-subtle hover:text-scout-ink"
          onClick={dismiss}
        >
          ×
        </button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>How&apos;s Scout working out?</DialogTitle>
            <DialogDescription>
              Anything broken, confusing, or missing? Your message goes to the
              Scout team. We&apos;ll only ask you this once.
            </DialogDescription>
          </DialogHeader>
          <FeedbackForm
            onCancel={() => {
              setOpen(false);
            }}
            onSubmitted={() => {
              markFeedbackSubmitted(user.discordId);
              setOpen(false);
              setHidden(true);
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
