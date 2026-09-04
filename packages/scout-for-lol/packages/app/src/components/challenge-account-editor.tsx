import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
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
import { ChallengeAccountSelection } from "#src/components/challenge-account-selection.tsx";
import { useTRPC } from "#src/lib/trpc.ts";

const AccountSelectionSchema = z.strictObject({
  accountIds: z.array(z.number().int().positive()).min(1),
});

export function ChallengeAccountEditor(props: {
  runId: string;
  runStatus: string;
  selectedAccounts: readonly { accountId: number }[];
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const formElement = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const accounts = useQuery(trpc.challenge.linkedAccounts.queryOptions());
  const change = useMutation(
    trpc.challenge.changeAccounts.mutationOptions({
      onSuccess: () => {
        setError(null);
        void queryClient.invalidateQueries({
          queryKey: trpc.challenge.getRun.queryKey({ runId: props.runId }),
        });
      },
      onError: (mutationError) => {
        setError(mutationError.message);
      },
    }),
  );
  const form = useScoutForm({
    defaultValues: { accountIds: new Array<number>() },
    validationLogic: submitThenChangeValidation,
    validators: { onDynamic: AccountSelectionSchema },
    onSubmit: ({ value }) => {
      const parsed = AccountSelectionSchema.parse(value);
      change.mutate({ runId: props.runId, accountIds: parsed.accountIds });
    },
    onSubmitInvalid: () => {
      focusFirstInvalid(formElement.current);
    },
  });

  useEffect(() => {
    form.reset({
      accountIds: props.selectedAccounts.map((account) => account.accountId),
    });
  }, [form, props.selectedAccounts]);

  if (accounts.isPending) {
    return <p className="text-sm text-scout-subtle">Loading Riot accounts…</p>;
  }
  if (accounts.isError) {
    return (
      <p className="text-sm text-scout-danger">{accounts.error.message}</p>
    );
  }
  const disabled = change.isPending || props.runStatus === "archived";
  return (
    <Card>
      <CardHeader>
        <CardTitle>Riot accounts</CardTitle>
        <CardDescription>
          Changing accounts creates a new evaluation revision from the original
          start date.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          ref={formElement}
          className="space-y-4"
          onSubmit={(event) => {
            handleFormSubmit(event, () => form.handleSubmit());
          }}
        >
          <fieldset disabled={disabled} className="space-y-2">
            <form.Field name="accountIds">
              {(field) => (
                <ChallengeAccountSelection
                  accounts={accounts.data}
                  name={field.name}
                  value={field.state.value}
                  onChange={field.handleChange}
                />
              )}
            </form.Field>
          </fieldset>
          <ServerFormError error={error} />
          <FormPendingStatus pending={change.isPending}>
            Recomputing challenge run…
          </FormPendingStatus>
          <Button type="submit" disabled={disabled}>
            Recompute with accounts
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
