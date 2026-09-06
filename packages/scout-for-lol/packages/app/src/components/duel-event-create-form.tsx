import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import {
  DuelBestOfSchema,
  DuelEventFormatSchema,
  DuelRulesetV1Schema,
} from "@scout-for-lol/data";
import { Button } from "@scout-for-lol/design-system/components/button";
import {
  FirstTurretField,
  optionalDuelIntegerTarget,
} from "#src/components/duel-form-fields.tsx";
import {
  FormPendingStatus,
  ServerFormError,
  focusFirstInvalid,
  handleFormSubmit,
  submitThenChangeValidation,
  useScoutForm,
} from "#src/components/semantic-form.tsx";
import { useTRPC } from "#src/lib/trpc.ts";

const OptionalBestOfSchema = z.enum(["", "1", "3", "5"]);

const EventCreateSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(120),
    channelId: z.string().min(1),
    format: DuelEventFormatSchema.exclude(["direct"]),
    competitorKind: z.enum(["player", "pair"]),
    bestOf: z.enum(["1", "3", "5"]),
    registrationMode: z.enum(["open", "invitations"]),
    seedMethod: z.enum(["manual", "random", "rolling_record"]),
    killTarget: optionalDuelIntegerTarget(1, 10),
    laneCsTarget: optionalDuelIntegerTarget(10, 500),
    firstTurret: z.boolean(),
    roundTwoBestOf: OptionalBestOfSchema,
    roundThreeBestOf: OptionalBestOfSchema,
    roundFourBestOf: OptionalBestOfSchema,
    roundFiveBestOf: OptionalBestOfSchema,
    roundSixBestOf: OptionalBestOfSchema,
    matchWindowHours: z
      .string()
      .regex(/^\d+$/)
      .transform(Number)
      .pipe(z.number().int().min(24).max(336)),
  })
  .superRefine((value, context) => {
    if (
      value.killTarget === null &&
      value.laneCsTarget === null &&
      !value.firstTurret
    ) {
      context.addIssue({
        code: "custom",
        message: "Choose at least one win condition",
        path: ["killTarget"],
      });
    }
  });

function initialValue(channelId: string): z.input<typeof EventCreateSchema> {
  return {
    name: "",
    channelId,
    format: "single_elimination",
    competitorKind: "player",
    bestOf: "1",
    registrationMode: "open",
    seedMethod: "random",
    killTarget: "1",
    laneCsTarget: "",
    firstTurret: false,
    roundTwoBestOf: "",
    roundThreeBestOf: "",
    roundFourBestOf: "",
    roundFiveBestOf: "",
    roundSixBestOf: "",
    matchWindowHours: "168",
  };
}

function roundOverrides(value: z.output<typeof EventCreateSchema>) {
  return [
    [2, value.roundTwoBestOf],
    [3, value.roundThreeBestOf],
    [4, value.roundFourBestOf],
    [5, value.roundFiveBestOf],
    [6, value.roundSixBestOf],
  ].flatMap(([roundNumber, bestOf]) =>
    bestOf === "" || roundNumber === undefined
      ? []
      : [
          {
            roundNumber: Number(roundNumber),
            bestOf: DuelBestOfSchema.parse(Number(bestOf)),
          },
        ],
  );
}

export function DuelEventCreateForm(props: {
  guildId: string;
  channels: readonly { id: string; name: string }[];
  onCreated: (eventId: string) => void;
}) {
  const trpc = useTRPC();
  const formElement = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const firstChannelId = props.channels[0]?.id ?? "";
  const mutation = useMutation(
    trpc.duel.createEvent.mutationOptions({
      onSuccess: (event) => {
        form.reset(initialValue(firstChannelId));
        props.onCreated(event.id);
      },
      onError: (mutationError) => {
        setError(mutationError.message);
      },
    }),
  );
  const form = useScoutForm({
    defaultValues: initialValue(firstChannelId),
    validationLogic: submitThenChangeValidation,
    validators: { onDynamic: EventCreateSchema },
    onSubmit: ({ value }) => {
      const parsed = EventCreateSchema.parse(value);
      mutation.mutate({
        guildId: props.guildId,
        channelId: parsed.channelId,
        name: parsed.name,
        format: parsed.format,
        competitorKind: parsed.competitorKind,
        bestOf: DuelBestOfSchema.parse(Number(parsed.bestOf)),
        ruleset: DuelRulesetV1Schema.parse({
          version: 1,
          killTarget: parsed.killTarget,
          laneCsTarget: parsed.laneCsTarget,
          firstTurret: parsed.firstTurret,
        }),
        registrationMode: parsed.registrationMode,
        seedMethod: parsed.seedMethod,
        matchWindowHours: parsed.matchWindowHours,
        roundOverrides: roundOverrides(parsed),
      });
    },
    onSubmitInvalid: () => {
      focusFirstInvalid(formElement.current);
    },
  });
  return (
    <form
      ref={formElement}
      className="space-y-4"
      onSubmit={(event) => {
        handleFormSubmit(event, () => form.handleSubmit());
      }}
    >
      <fieldset
        className="grid gap-4 md:grid-cols-2"
        disabled={mutation.isPending}
      >
        <form.AppField name="name">
          {(field) => (
            <field.TextField
              id="event-name"
              label="Event name"
              required
              maxLength={120}
            />
          )}
        </form.AppField>
        <form.AppField name="channelId">
          {(field) => (
            <field.NativeSelectField
              id="event-channel"
              label="Status channel"
              required
              options={props.channels.map((channel) => ({
                value: channel.id,
                label: `#${channel.name}`,
              }))}
            />
          )}
        </form.AppField>
        <form.AppField name="format">
          {(field) => (
            <field.NativeSelectField
              id="event-format"
              label="Bracket"
              required
              options={[
                { value: "single_elimination", label: "Single elimination" },
                { value: "double_elimination", label: "Double elimination" },
                { value: "round_robin", label: "Round robin" },
              ]}
            />
          )}
        </form.AppField>
        <form.AppField name="competitorKind">
          {(field) => (
            <field.NativeSelectField
              id="event-kind"
              label="Competitors"
              required
              options={[
                { value: "player", label: "1v1" },
                { value: "pair", label: "2v2" },
              ]}
            />
          )}
        </form.AppField>
        <form.AppField name="bestOf">
          {(field) => (
            <field.NativeSelectField
              id="event-best-of"
              label="Default series"
              required
              options={[
                { value: "1", label: "Best of 1" },
                { value: "3", label: "Best of 3" },
                { value: "5", label: "Best of 5" },
              ]}
            />
          )}
        </form.AppField>
        <form.AppField name="registrationMode">
          {(field) => (
            <field.NativeSelectField
              id="event-registration"
              label="Registration"
              required
              options={[
                { value: "open", label: "Open signup" },
                { value: "invitations", label: "Invitations" },
              ]}
            />
          )}
        </form.AppField>
        <form.AppField name="seedMethod">
          {(field) => (
            <field.NativeSelectField
              id="event-seed"
              label="Seeding"
              required
              options={[
                { value: "random", label: "Random" },
                { value: "rolling_record", label: "Rolling records" },
                { value: "manual", label: "Manual registration order" },
              ]}
            />
          )}
        </form.AppField>
        <form.AppField name="killTarget">
          {(field) => (
            <field.TextField
              id="event-kills"
              label="Kill target"
              type="number"
              min={1}
              max={10}
              description="Leave blank to disable this condition."
            />
          )}
        </form.AppField>
        <form.AppField name="laneCsTarget">
          {(field) => (
            <field.TextField
              id="event-lane-cs"
              label="Lane-CS target"
              type="number"
              min={10}
              max={500}
              description="Jungle CS is excluded. Leave blank to disable."
            />
          )}
        </form.AppField>
        <form.Field name="firstTurret">
          {(field) => (
            <FirstTurretField
              id="event-first-turret"
              name={field.name}
              checked={field.state.value}
              onBlur={field.handleBlur}
              onChange={field.handleChange}
            />
          )}
        </form.Field>
        <form.AppField name="matchWindowHours">
          {(field) => (
            <field.TextField
              id="event-window"
              label="Window per round (hours)"
              type="number"
              required
              min={24}
              max={336}
            />
          )}
        </form.AppField>
      </fieldset>
      <fieldset
        className="grid gap-4 md:grid-cols-2"
        disabled={mutation.isPending}
      >
        <legend className="mb-2 text-sm font-semibold">
          Optional per-round series overrides
        </legend>
        <form.AppField name="roundTwoBestOf">
          {(field) => (
            <field.NativeSelectField
              id="event-round-two"
              label="Round 2"
              options={[
                { value: "", label: "Use event default" },
                { value: "1", label: "Best of 1" },
                { value: "3", label: "Best of 3" },
                { value: "5", label: "Best of 5" },
              ]}
            />
          )}
        </form.AppField>
        <form.AppField name="roundThreeBestOf">
          {(field) => (
            <field.NativeSelectField
              id="event-round-three"
              label="Round 3"
              options={[
                { value: "", label: "Use event default" },
                { value: "1", label: "Best of 1" },
                { value: "3", label: "Best of 3" },
                { value: "5", label: "Best of 5" },
              ]}
            />
          )}
        </form.AppField>
        <form.AppField name="roundFourBestOf">
          {(field) => (
            <field.NativeSelectField
              id="event-round-four"
              label="Round 4"
              options={[
                { value: "", label: "Use event default" },
                { value: "1", label: "Best of 1" },
                { value: "3", label: "Best of 3" },
                { value: "5", label: "Best of 5" },
              ]}
            />
          )}
        </form.AppField>
        <form.AppField name="roundFiveBestOf">
          {(field) => (
            <field.NativeSelectField
              id="event-round-five"
              label="Round 5"
              options={[
                { value: "", label: "Use event default" },
                { value: "1", label: "Best of 1" },
                { value: "3", label: "Best of 3" },
                { value: "5", label: "Best of 5" },
              ]}
            />
          )}
        </form.AppField>
        <form.AppField name="roundSixBestOf">
          {(field) => (
            <field.NativeSelectField
              id="event-round-six"
              label="Round 6"
              options={[
                { value: "", label: "Use event default" },
                { value: "1", label: "Best of 1" },
                { value: "3", label: "Best of 3" },
                { value: "5", label: "Best of 5" },
              ]}
            />
          )}
        </form.AppField>
      </fieldset>
      <ServerFormError error={error} />
      <FormPendingStatus pending={mutation.isPending}>
        Creating event…
      </FormPendingStatus>
      <Button type="submit" disabled={mutation.isPending}>
        Create event
      </Button>
    </form>
  );
}
