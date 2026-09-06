import { useRef, useState, type SyntheticEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { DuelBestOfSchema, DuelRulesetV1Schema } from "@scout-for-lol/data";
import { Button } from "@scout-for-lol/design-system/components/button";
import {
  DuelOptionSelectField,
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

const DirectDuelFormSchema = z
  .strictObject({
    channelId: z.string().min(1),
    competitorKind: z.enum(["player", "pair"]),
    firstOne: z.string().min(1),
    firstTwo: z.string(),
    firstTeamName: z.string().trim().max(80),
    secondOne: z.string().min(1),
    secondTwo: z.string(),
    secondTeamName: z.string().trim().max(80),
    bestOf: z.enum(["1", "3", "5"]),
    killTarget: optionalDuelIntegerTarget(1, 10),
    laneCsTarget: optionalDuelIntegerTarget(10, 500),
    firstTurret: z.boolean(),
    matchWindowHours: z
      .string()
      .regex(/^\d+$/)
      .transform(Number)
      .pipe(z.number().int().min(24).max(336)),
  })
  .superRefine((value, context) => {
    if (value.competitorKind === "pair") {
      for (const field of ["firstTwo", "secondTwo"] as const) {
        if (value[field].length === 0) {
          context.addIssue({
            code: "custom",
            message: "Choose both players for each 2v2 team",
            path: [field],
          });
        }
      }
    }
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

type Account = {
  accountId: number;
  accountAlias: string;
  playerAlias: string;
};

function initialValue(channelId: string): z.input<typeof DirectDuelFormSchema> {
  return {
    channelId,
    competitorKind: "player",
    firstOne: "",
    firstTwo: "",
    firstTeamName: "",
    secondOne: "",
    secondTwo: "",
    secondTeamName: "",
    bestOf: "1",
    killTarget: "1",
    laneCsTarget: "",
    firstTurret: false,
    matchWindowHours: "168",
  };
}

function selectedAccount(accounts: readonly Account[], value: string) {
  const account = accounts.find(
    (candidate) => candidate.accountId.toString() === value,
  );
  if (account === undefined) throw new Error("Choose a tracked Riot account");
  return account.accountId;
}

function AccountField(props: {
  id: string;
  name: string;
  label: string;
  value: string;
  accounts: readonly Account[];
  onChange: (value: string) => void;
}) {
  return (
    <DuelOptionSelectField
      id={props.id}
      name={props.name}
      label={props.label}
      value={props.value}
      placeholder="Choose an account"
      options={props.accounts.map((account) => ({
        value: account.accountId.toString(),
        label: `${account.playerAlias} · ${account.accountAlias}`,
      }))}
      onChange={props.onChange}
    />
  );
}

export function DirectDuelForm(props: {
  guildId: string;
  accounts: readonly Account[];
  channels: readonly { id: string; name: string }[];
  onCreated: (seriesId: string) => void;
}) {
  const trpc = useTRPC();
  const formElement = useRef<HTMLFormElement>(null);
  const requestId = useRef(crypto.randomUUID());
  const [error, setError] = useState<string | null>(null);
  const firstChannelId = props.channels[0]?.id ?? "";
  const mutation = useMutation(
    trpc.duel.challenge.mutationOptions({
      onSuccess: (result) => {
        requestId.current = crypto.randomUUID();
        form.reset(initialValue(firstChannelId));
        props.onCreated(result.seriesId);
      },
      onError: (mutationError) => {
        setError(mutationError.message);
      },
    }),
  );
  const form = useScoutForm({
    defaultValues: initialValue(firstChannelId),
    validationLogic: submitThenChangeValidation,
    validators: { onDynamic: DirectDuelFormSchema },
    onSubmit: ({ value }) => {
      const parsed = DirectDuelFormSchema.parse(value);
      const first = [selectedAccount(props.accounts, parsed.firstOne)];
      const second = [selectedAccount(props.accounts, parsed.secondOne)];
      if (parsed.competitorKind === "pair") {
        first.push(selectedAccount(props.accounts, parsed.firstTwo));
        second.push(selectedAccount(props.accounts, parsed.secondTwo));
      }
      mutation.mutate({
        requestId: requestId.current,
        guildId: props.guildId,
        channelId: parsed.channelId,
        competitorKind: parsed.competitorKind,
        first: {
          accountIds: first,
          ...(parsed.competitorKind === "pair" &&
          parsed.firstTeamName.length > 0
            ? { teamName: parsed.firstTeamName }
            : {}),
        },
        second: {
          accountIds: second,
          ...(parsed.competitorKind === "pair" &&
          parsed.secondTeamName.length > 0
            ? { teamName: parsed.secondTeamName }
            : {}),
        },
        bestOf: DuelBestOfSchema.parse(Number(parsed.bestOf)),
        ruleset: DuelRulesetV1Schema.parse({
          version: 1,
          killTarget: parsed.killTarget,
          laneCsTarget: parsed.laneCsTarget,
          firstTurret: parsed.firstTurret,
        }),
        matchWindowHours: parsed.matchWindowHours,
      });
    },
    onSubmitInvalid: () => {
      focusFirstInvalid(formElement.current);
    },
  });
  function submitDirectDuel(event: SyntheticEvent<HTMLFormElement>): void {
    handleFormSubmit(event, () => form.handleSubmit());
  }
  return (
    <form ref={formElement} className="space-y-4" onSubmit={submitDirectDuel}>
      <fieldset
        className="grid gap-4 md:grid-cols-2"
        disabled={mutation.isPending}
      >
        <form.AppField name="channelId">
          {(field) => (
            <field.NativeSelectField
              id="duel-channel"
              label="Status channel"
              required
              options={props.channels.map((channel) => ({
                value: channel.id,
                label: `#${channel.name}`,
              }))}
            />
          )}
        </form.AppField>
        <form.AppField name="competitorKind">
          {(field) => (
            <field.NativeSelectField
              id="duel-kind"
              label="Format"
              required
              options={[
                { value: "player", label: "1v1" },
                { value: "pair", label: "2v2" },
              ]}
            />
          )}
        </form.AppField>
        <form.Field name="firstOne">
          {(field) => (
            <AccountField
              id="duel-first-one"
              name={field.name}
              label="Side one"
              accounts={props.accounts}
              value={field.state.value}
              onChange={field.handleChange}
            />
          )}
        </form.Field>
        <form.Field name="secondOne">
          {(field) => (
            <AccountField
              id="duel-second-one"
              name={field.name}
              label="Side two"
              accounts={props.accounts}
              value={field.state.value}
              onChange={field.handleChange}
            />
          )}
        </form.Field>
        <form.Subscribe selector={(state) => state.values.competitorKind}>
          {(kind) =>
            kind === "pair" ? (
              <>
                <form.Field name="firstTwo">
                  {(field) => (
                    <AccountField
                      id="duel-first-two"
                      name={field.name}
                      label="Side one teammate"
                      accounts={props.accounts}
                      value={field.state.value}
                      onChange={field.handleChange}
                    />
                  )}
                </form.Field>
                <form.Field name="secondTwo">
                  {(field) => (
                    <AccountField
                      id="duel-second-two"
                      name={field.name}
                      label="Side two teammate"
                      accounts={props.accounts}
                      value={field.state.value}
                      onChange={field.handleChange}
                    />
                  )}
                </form.Field>
                <form.AppField name="firstTeamName">
                  {(field) => (
                    <field.TextField
                      id="duel-first-team-name"
                      label="Side one team name (optional)"
                      maxLength={80}
                    />
                  )}
                </form.AppField>
                <form.AppField name="secondTeamName">
                  {(field) => (
                    <field.TextField
                      id="duel-second-team-name"
                      label="Side two team name (optional)"
                      maxLength={80}
                    />
                  )}
                </form.AppField>
              </>
            ) : null
          }
        </form.Subscribe>
        <form.AppField name="bestOf">
          {(field) => (
            <field.NativeSelectField
              id="duel-best-of"
              label="Series"
              required
              options={[
                { value: "1", label: "Best of 1" },
                { value: "3", label: "Best of 3" },
                { value: "5", label: "Best of 5" },
              ]}
            />
          )}
        </form.AppField>
        <form.AppField name="killTarget">
          {(field) => (
            <field.TextField
              id="duel-kills"
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
              id="duel-lane-cs"
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
              id="duel-first-turret"
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
              id="duel-window"
              label="Match window (hours)"
              type="number"
              required
              min={24}
              max={336}
            />
          )}
        </form.AppField>
      </fieldset>
      <ServerFormError error={error} />
      <FormPendingStatus pending={mutation.isPending}>
        Creating duel…
      </FormPendingStatus>
      <Button type="submit" disabled={mutation.isPending}>
        Send challenge
      </Button>
    </form>
  );
}
