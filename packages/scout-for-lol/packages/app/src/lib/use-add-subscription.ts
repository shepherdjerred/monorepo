import { useCallback, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTRPC } from "#src/lib/trpc.ts";
import { track } from "#src/lib/analytics.ts";
import {
  SubscriptionFormSchema,
  type SubscriptionFormValue,
} from "#src/lib/form-schemas.ts";

/**
 * The editable fields for a single subscription. Shared by the
 * AddSubscriptionDialog and the onboarding wizard so the form contract
 * lives in one place.
 */
/**
 * Wraps the `subscription.add` mutation and maps every result `kind` to a
 * user-facing message. Callers supply `onAdded`, which fires on a
 * successful create (or when the subscription already existed).
 */
export function useAddSubscription(opts: {
  guildId: string;
  onAdded: () => void;
}) {
  const trpc = useTRPC();
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation(
    trpc.subscription.add.mutationOptions({
      onSuccess: (result) => {
        // Rich outcome taxonomy from the discriminated result — richer than the
        // generic success/error the MutationCache meta wiring would give, so
        // this mutation tracks explicitly and carries no `meta.analyticsEvent`.
        track("subscription_add", { kind: result.kind });
        switch (result.kind) {
          case "created":
          case "subscription-already-exists":
            setError(null);
            opts.onAdded();
            return;
          case "account-already-subscribed":
            setError(
              `That account is already subscribed under "${result.existingPlayerAlias}".`,
            );
            return;
          case "subscription-limit-reached":
            setError(
              `Subscription limit reached (${result.current.toString()}/${result.max.toString()}).`,
            );
            return;
          case "account-limit-reached":
            setError(
              `Account limit reached (${result.current.toString()}/${result.max.toString()}).`,
            );
            return;
          case "riot-id-not-found":
            setError(`Riot ID not found: ${result.message}`);
            return;
          case "internal-error":
            setError(result.message);
            return;
        }
      },
      onError: (err) => {
        track("subscription_add", { kind: "error" });
        setError(err.message);
      },
    }),
  );

  function submit(value: SubscriptionFormValue): void {
    setError(null);
    const parsed = SubscriptionFormSchema.parse(value);
    mutation.mutate({
      guildId: opts.guildId,
      channelId: parsed.channelId,
      region: parsed.region,
      riotId: parsed.riotId,
      alias: parsed.alias,
      filters: parsed.filters,
      ...(parsed.discordUserId.length > 0 && {
        discordUserId: parsed.discordUserId,
      }),
    });
  }

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    submit,
    isPending: mutation.isPending,
    error,
    clearError,
  };
}
