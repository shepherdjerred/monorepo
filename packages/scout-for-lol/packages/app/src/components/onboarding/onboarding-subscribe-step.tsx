import { useRef } from "react";
import { useSelector } from "@tanstack/react-form";
import { Button } from "@scout-for-lol/design-system/components/button";
import {
  Card,
  CardContent,
} from "@scout-for-lol/design-system/components/card";
import {
  SubscriptionFields,
  subscriptionFormOptions,
} from "#src/components/subscriptions/subscription-fields.tsx";
import { useAddSubscription } from "#src/lib/use-add-subscription.ts";
import type { OnboardingStepKind } from "@scout-for-lol/data";
import { OnboardingShell } from "#src/components/onboarding/onboarding-shell.tsx";
import { OnboardingNoChannels } from "#src/components/onboarding/onboarding-no-channels.tsx";
import {
  emptySubscriptionFormValue,
  SubscriptionFormSchema,
} from "#src/lib/form-schemas.ts";
import {
  focusFirstInvalid,
  FormPendingStatus,
  handleFormSubmit,
  ServerFormError,
  submitThenChangeValidation,
  useScoutForm,
} from "#src/components/semantic-form.tsx";
import {
  UnsavedFormDialog,
  useUnsavedForm,
  useUnsavedFormTransition,
} from "#src/hooks/use-unsaved-form.tsx";

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
  const formElement = useRef<HTMLFormElement>(null);
  const initialValue =
    props.mode === "self"
      ? {
          ...emptySubscriptionFormValue(initialChannel),
          alias: props.username,
          discordUserId: props.discordId,
        }
      : emptySubscriptionFormValue(initialChannel);

  const { submit, isPending, error } = useAddSubscription({
    guildId: props.guildId,
    onAdded: () => {
      props.onAdded();
      if (props.mode === "self") {
        form.reset();
        props.onContinue();
      } else {
        form.reset(emptySubscriptionFormValue(initialChannel));
      }
    },
  });

  const form = useScoutForm({
    ...subscriptionFormOptions,
    defaultValues: initialValue,
    validationLogic: submitThenChangeValidation,
    validators: { onDynamic: SubscriptionFormSchema },
    onSubmit: ({ value }) => {
      submit(value);
    },
    onSubmitInvalid: () => {
      focusFirstInvalid(formElement.current);
    },
  });
  const isDirty = useSelector(form.store, (state) => state.isDirty);
  const transition = useUnsavedFormTransition(isDirty, isPending);
  const blocker = useUnsavedForm(
    isDirty,
    isPending,
    transition.isNavigationAllowed,
  );

  const step: OnboardingStepKind =
    props.mode === "self" ? "subscribe-self" : "subscribe-more";
  const title =
    props.mode === "self" ? "Track your own account" : "Add friends";
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
        onSkip={() => {
          transition.request(props.onSkip);
        }}
      >
        <OnboardingNoChannels onBack={props.onBack} />
      </OnboardingShell>
    );
  }

  const trackedAliases = [
    ...new Set(props.existingSubs.map((subscription) => subscription.alias)),
  ].toSorted((left, right) => left.localeCompare(right));

  return (
    <OnboardingShell
      step={step}
      title={title}
      description={description}
      onSkip={() => {
        transition.request(props.onSkip);
      }}
    >
      <div className="space-y-4">
        {props.mode === "more" && trackedAliases.length > 0 && (
          <Card>
            <CardContent className="space-y-1 p-4">
              <p className="text-sm font-medium">
                Tracking {trackedAliases.length.toString()} players so far
              </p>
              <ul className="grid max-h-48 grid-cols-2 gap-x-6 gap-y-1 overflow-y-auto pr-2 text-sm text-scout-subtle sm:grid-cols-3">
                {trackedAliases.map((alias) => (
                  <li key={alias} className="truncate">
                    {alias}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        <form.AppForm>
          <form
            ref={formElement}
            onSubmit={(event) => {
              handleFormSubmit(event, () => form.handleSubmit());
            }}
            aria-busy={isPending}
            className="space-y-4"
          >
            <fieldset disabled={isPending} className="m-0 border-0 p-0">
              <SubscriptionFields
                form={form}
                idPrefix={props.mode === "self" ? "onb-self" : "onb-more"}
                guildId={props.guildId}
                channels={props.channels}
              />
            </fieldset>

            <ServerFormError error={error} />

            <div className="flex items-center justify-between">
              <Button
                variant="ghost"
                type="button"
                onClick={() => {
                  transition.request(props.onBack);
                }}
              >
                ← Back
              </Button>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    transition.request(props.onContinue);
                  }}
                >
                  Skip
                </Button>
                <Button type="submit" disabled={isPending}>
                  {props.mode === "self"
                    ? isPending
                      ? "Adding…"
                      : "Track me"
                    : isPending
                      ? "Adding…"
                      : "Add friend"}
                </Button>
              </div>
            </div>
            <FormPendingStatus pending={isPending}>
              Adding subscription…
            </FormPendingStatus>
          </form>
        </form.AppForm>
        <UnsavedFormDialog blocker={blocker} />
        {transition.dialog}
      </div>
    </OnboardingShell>
  );
}
