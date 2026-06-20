import { useState } from "react";
import { Button } from "#src/components/ui/button.tsx";
import { Card, CardContent } from "#src/components/ui/card.tsx";
import { SubscriptionFields } from "#src/components/subscription-fields.tsx";
import {
  emptySubscriptionValue,
  useAddSubscription,
  type SubscriptionFieldsValue,
} from "#src/lib/use-add-subscription.ts";
import type { OnboardingStepKind } from "#src/lib/onboarding-steps.ts";
import { OnboardingShell } from "#src/components/onboarding/onboarding-shell.tsx";
import { OnboardingNoChannels } from "#src/components/onboarding/onboarding-no-channels.tsx";

type Mode = "self" | "more";

export function OnboardingSubscribeStep(props: {
  mode: Mode;
  guildId: string;
  channels: { id: string; name: string }[];
  username: string;
  discordId: string;
  existingSubs: { alias: string; channelId: string }[];
  onAdded: () => void;
  onContinue: () => void;
  onBack: () => void;
  onSkip: () => void;
}) {
  const initialChannel = props.channels[0]?.id ?? "";
  const [value, setValue] = useState<SubscriptionFieldsValue>(() =>
    props.mode === "self"
      ? {
          channelId: initialChannel,
          region: "AMERICA_NORTH",
          riotId: "",
          alias: props.username,
          discordUserId: props.discordId,
        }
      : emptySubscriptionValue(initialChannel),
  );

  const { submit, isPending, error } = useAddSubscription({
    guildId: props.guildId,
    onAdded: () => {
      props.onAdded();
      if (props.mode === "self") {
        props.onContinue();
      } else {
        setValue(emptySubscriptionValue(initialChannel));
      }
    },
  });

  const step: OnboardingStepKind =
    props.mode === "self" ? "subscribe-self" : "subscribe-more";
  const title =
    props.mode === "self"
      ? "Track your own account"
      : "Add teammates (optional)";
  const description =
    props.mode === "self"
      ? "Add your League account so you get a report after every game you play."
      : "Track anyone else you want reports for. Add as many as you like — or skip and do it later.";

  if (props.channels.length === 0) {
    return (
      <OnboardingShell
        step={step}
        title={title}
        description={description}
        onSkip={props.onSkip}
      >
        <OnboardingNoChannels onBack={props.onBack} />
      </OnboardingShell>
    );
  }

  function handleSubmit(event: React.SyntheticEvent) {
    event.preventDefault();
    submit(value);
  }

  return (
    <OnboardingShell
      step={step}
      title={title}
      description={description}
      onSkip={props.onSkip}
    >
      <div className="space-y-4">
        {props.mode === "more" && props.existingSubs.length > 0 && (
          <Card>
            <CardContent className="space-y-1 p-4">
              <p className="text-sm font-medium">Tracking so far</p>
              <ul className="list-inside list-disc text-sm text-muted-foreground">
                {props.existingSubs.map((sub) => (
                  <li key={`${sub.alias}-${sub.channelId}`}>{sub.alias}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <SubscriptionFields
            idPrefix={props.mode === "self" ? "onb-self" : "onb-more"}
            channels={props.channels}
            value={value}
            onChange={setValue}
          />

          {error !== null && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <div className="flex items-center justify-between">
            <Button variant="ghost" type="button" onClick={props.onBack}>
              ← Back
            </Button>
            <div className="flex gap-2">
              {props.mode === "self" ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={props.onContinue}
                  >
                    Skip this step
                  </Button>
                  <Button type="submit" disabled={isPending}>
                    {isPending ? "Adding…" : "Track me"}
                  </Button>
                </>
              ) : (
                <>
                  <Button type="submit" variant="outline" disabled={isPending}>
                    {isPending ? "Adding…" : "Add another"}
                  </Button>
                  <Button type="button" onClick={props.onContinue}>
                    Continue
                  </Button>
                </>
              )}
            </div>
          </div>
        </form>
      </div>
    </OnboardingShell>
  );
}
