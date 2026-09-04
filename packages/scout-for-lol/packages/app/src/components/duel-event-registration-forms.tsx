import { useRef } from "react";
import { z } from "zod";
import type { PlayerId } from "@scout-for-lol/data";
import { Button } from "@scout-for-lol/design-system/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@scout-for-lol/design-system/components/card";
import {
  FormPendingStatus,
  ServerFormError,
  focusFirstInvalid,
  handleFormSubmit,
  submitThenChangeValidation,
  useScoutForm,
} from "#src/components/semantic-form.tsx";

const EntrantFormSchema = z.strictObject({
  firstAccountId: z.string().min(1),
  secondAccountId: z.string(),
  teamName: z.string().trim().max(80),
});

function entrantFormSchema(kind: string) {
  return EntrantFormSchema.superRefine((value, context) => {
    if (kind === "pair" && value.secondAccountId.length === 0) {
      context.addIssue({
        code: "custom",
        message: "Choose a teammate for a 2v2 entrant",
        path: ["secondAccountId"],
      });
    }
  });
}

type Account = {
  accountId: number;
  accountAlias: string;
  playerId: PlayerId;
  playerAlias: string;
};

function selectedAccountId(accounts: readonly Account[], selected: string) {
  const account = accounts.find(
    (candidate) => candidate.accountId.toString() === selected,
  );
  if (account === undefined) throw new Error("Choose a tracked Riot account");
  return account.accountId;
}

function EntrantForm(props: {
  title: string;
  description: string;
  kind: string;
  accounts: readonly Account[];
  pending: boolean;
  submitLabel: string;
  onSubmit: (selection: { accountIds: number[]; teamName?: string }) => void;
}) {
  const formElement = useRef<HTMLFormElement>(null);
  const schema = entrantFormSchema(props.kind);
  const form = useScoutForm({
    defaultValues: { firstAccountId: "", secondAccountId: "", teamName: "" },
    validationLogic: submitThenChangeValidation,
    validators: { onDynamic: schema },
    onSubmit: ({ value }) => {
      const parsed = schema.parse(value);
      const ids = [selectedAccountId(props.accounts, parsed.firstAccountId)];
      if (props.kind === "pair")
        ids.push(selectedAccountId(props.accounts, parsed.secondAccountId));
      props.onSubmit({
        accountIds: ids,
        ...(parsed.teamName.length === 0 ? {} : { teamName: parsed.teamName }),
      });
    },
    onSubmitInvalid: () => {
      focusFirstInvalid(formElement.current);
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{props.title}</CardTitle>
        <CardDescription>{props.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          ref={formElement}
          className="space-y-4"
          onSubmit={(event) => {
            handleFormSubmit(event, () => form.handleSubmit());
          }}
        >
          <fieldset className="space-y-3" disabled={props.pending}>
            <form.Field name="firstAccountId">
              {(field) => (
                <label
                  className="grid gap-1 text-sm"
                  htmlFor={`${props.submitLabel}-first`}
                >
                  <span className="font-medium">Player</span>
                  <select
                    className="scout-control"
                    id={`${props.submitLabel}-first`}
                    name={field.name}
                    required
                    value={field.state.value}
                    onChange={(event) => {
                      field.handleChange(event.currentTarget.value);
                    }}
                  >
                    <option value="">Choose an account</option>
                    {props.accounts.map((account) => (
                      <option
                        key={account.accountId}
                        value={account.accountId.toString()}
                      >
                        {account.playerAlias} · {account.accountAlias}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </form.Field>
            {props.kind === "pair" ? (
              <form.Field name="secondAccountId">
                {(field) => (
                  <label
                    className="grid gap-1 text-sm"
                    htmlFor={`${props.submitLabel}-second`}
                  >
                    <span className="font-medium">Teammate</span>
                    <select
                      className="scout-control"
                      id={`${props.submitLabel}-second`}
                      name={field.name}
                      required
                      value={field.state.value}
                      onChange={(event) => {
                        field.handleChange(event.currentTarget.value);
                      }}
                    >
                      <option value="">Choose an account</option>
                      {props.accounts.map((account) => (
                        <option
                          key={account.accountId}
                          value={account.accountId.toString()}
                        >
                          {account.playerAlias} · {account.accountAlias}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </form.Field>
            ) : null}
            {props.kind === "pair" ? (
              <form.AppField name="teamName">
                {(field) => (
                  <field.TextField
                    id={`${props.submitLabel}-team`}
                    label="Team name (optional)"
                    maxLength={80}
                  />
                )}
              </form.AppField>
            ) : null}
          </fieldset>
          <ServerFormError error={null} />
          <FormPendingStatus pending={props.pending}>
            Saving entrant…
          </FormPendingStatus>
          <Button type="submit" disabled={props.pending}>
            {props.submitLabel}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function DuelEventRegistrationForms(props: {
  registrationOpen: boolean;
  registrationMode: string;
  competitorKind: string;
  linkedAccounts: readonly Account[];
  eligibleAccounts: readonly Account[] | undefined;
  canInvite: boolean;
  registerPending: boolean;
  invitePending: boolean;
  onRegister: (selection: { accountIds: number[]; teamName?: string }) => void;
  onInvite: (selection: { accountIds: number[]; teamName?: string }) => void;
}) {
  if (!props.registrationOpen) return null;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {props.registrationMode === "open" ? (
        <EntrantForm
          title="Register"
          description="Open signup uses Riot accounts linked to your Discord identity."
          kind={props.competitorKind}
          accounts={props.linkedAccounts}
          pending={props.registerPending}
          submitLabel="Register"
          onSubmit={props.onRegister}
        />
      ) : null}
      {props.canInvite && props.eligibleAccounts !== undefined ? (
        <EntrantForm
          title="Invite entrant"
          description="Organizers can invite any tracked guild player. Invitations remain private until consent."
          kind={props.competitorKind}
          accounts={props.eligibleAccounts}
          pending={props.invitePending}
          submitLabel="Invite"
          onSubmit={props.onInvite}
        />
      ) : null}
    </div>
  );
}
