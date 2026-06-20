import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { RiotIdSchema } from "@scout-for-lol/data";
import { useTRPC } from "#src/lib/trpc.ts";
import type { RegionValue } from "#src/lib/regions.ts";

/**
 * The editable fields for a single subscription. Shared by the
 * AddSubscriptionDialog and the onboarding wizard so the form contract
 * lives in one place.
 */
export type SubscriptionFieldsValue = {
  channelId: string;
  region: RegionValue;
  riotId: string;
  alias: string;
  discordUserId: string;
};

export function emptySubscriptionValue(
  channelId: string,
): SubscriptionFieldsValue {
  return {
    channelId,
    region: "AMERICA_NORTH",
    riotId: "",
    alias: "",
    discordUserId: "",
  };
}

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
        setError(err.message);
      },
    }),
  );

  function submit(value: SubscriptionFieldsValue): void {
    setError(null);
    // Same schema the backend uses; reusing it keeps the contract
    // single-sourced. The server re-parses + transforms on receipt.
    const riotIdParse = RiotIdSchema.safeParse(value.riotId);
    if (!riotIdParse.success) {
      setError("Riot ID must be in the form game_name#tag");
      return;
    }
    mutation.mutate({
      guildId: opts.guildId,
      channelId: value.channelId,
      region: value.region,
      riotId: value.riotId,
      alias: value.alias.trim(),
      ...(value.discordUserId.length > 0 && {
        discordUserId: value.discordUserId,
      }),
    });
  }

  return {
    submit,
    isPending: mutation.isPending,
    error,
    clearError: () => {
      setError(null);
    },
  };
}
