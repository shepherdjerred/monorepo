import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { MessageSquare } from "lucide-react";
import { useTRPC } from "#src/lib/trpc.ts";
import { track } from "#src/lib/analytics.ts";
import {
  isFeedbackDismissed,
  markFeedbackDismissed,
  markFeedbackSubmitted,
} from "#src/lib/feedback-storage.ts";
import { STALE_TIME_SLOW_LIST } from "#src/lib/stale-times.ts";
import { Textarea } from "#src/components/ui/textarea.tsx";
import { Label } from "#src/components/ui/label.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "#src/components/ui/dialog.tsx";
import {
  DialogFormError,
  DialogFormFooter,
} from "#src/components/dialog-form.tsx";

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
    trpc.auth.sessionState.queryOptions(undefined, { retry: false }),
  );
  const user = session.data?.user ?? null;

  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);

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

  // Only ask people who have actually used Scout: at least one tracked
  // subscription somewhere. Asking someone who never configured anything
  // produces noise, not signal — that population gets the onboarding ladder.
  const guilds = useQuery(
    trpc.guild.listManageable.queryOptions(undefined, {
      staleTime: STALE_TIME_SLOW_LIST,
    }),
  );

  if (user === null || hidden) return null;
  if (isFeedbackDismissed(user.discordId)) return null;
  if ((guilds.data ?? []).length === 0) return null;

  const accountAgeDays =
    (Date.now() - new Date(user.createdAt).getTime()) / 86_400_000;
  if (accountAgeDays < MIN_ACCOUNT_AGE_DAYS) return null;

  const dismiss = () => {
    markFeedbackDismissed(user.discordId);
    track("feedback_dismissed");
    setHidden(true);
  };

  return (
    <>
      <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground shadow-md">
        <MessageSquare className="h-3.5 w-3.5 shrink-0" />
        <span>How&apos;s Scout working out?</span>
        <button
          type="button"
          className="font-medium text-foreground underline-offset-2 hover:underline"
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
          className="text-sm leading-none text-muted-foreground hover:text-foreground"
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
            onSubmit={(event) => {
              event.preventDefault();
              setError(null);
              submit.mutate({ body: body.trim() });
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="feedback-body">Your feedback</Label>
              <Textarea
                id="feedback-body"
                value={body}
                onChange={(event) => {
                  setBody(event.target.value);
                }}
                rows={5}
                maxLength={4000}
                placeholder="What's working, what isn't, what you wish it did…"
                required
              />
            </div>
            <DialogFormError error={error} />
            <DialogFormFooter
              onCancel={() => {
                setOpen(false);
              }}
              pending={submit.isPending}
              submitLabel="Send feedback"
              pendingLabel="Sending…"
              submitDisabled={body.trim().length === 0}
            />
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
