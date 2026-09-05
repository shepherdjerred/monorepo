import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@scout-for-lol/design-system/components/button";
import {
  focusFirstInvalid,
  handleFormSubmit,
  submitThenChangeValidation,
  useScoutForm,
} from "#src/components/semantic-form.tsx";
import { BucksContributionFormSchema } from "#src/lib/bucks-forms.ts";
import { useTRPC } from "#src/lib/trpc.ts";

type PreparedAction = {
  intentId: string;
  expiresAt: Date;
  action: string;
  amount: string | null;
  targets: string[];
  irreversible: boolean;
};

function contributionPayload(amount: number | undefined) {
  if (amount === undefined) {
    throw new Error("A contribution action requires an amount.");
  }
  return { kind: "dare_contribute" as const, amount };
}

export function BucksDareActions(props: {
  guildId: string;
  dareId: number;
  revision: number;
  availableActions: string[];
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [prepared, setPrepared] = useState<PreparedAction | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const prepare = useMutation(trpc.bucks.darePrepareAction.mutationOptions());
  const confirm = useMutation(trpc.bucks.dareConfirmAction.mutationOptions());
  const deleteDraft = useMutation(trpc.bucks.dareDeleteDraft.mutationOptions());
  const contributionFormElement = useRef<HTMLFormElement>(null);
  const contributionForm = useScoutForm({
    defaultValues: { contributionAmount: "10" },
    validationLogic: submitThenChangeValidation,
    validators: { onDynamic: BucksContributionFormSchema },
    onSubmit: ({ value }) => {
      const parsed = BucksContributionFormSchema.parse(value);
      prepareAction("contribute", parsed.contributionAmount);
    },
    onSubmitInvalid: () => {
      focusFirstInvalid(contributionFormElement.current);
    },
  });

  if (props.availableActions.length === 0) return null;

  function invalidateDares(): void {
    void queryClient.invalidateQueries({
      queryKey: trpc.bucks.dareList.pathKey(),
    });
    void queryClient.invalidateQueries({
      queryKey: trpc.bucks.dareInspect.pathKey(),
    });
    void queryClient.invalidateQueries({
      queryKey: trpc.bucks.dareEvidence.pathKey(),
    });
  }

  function prepareAction(action: string, contributionAmount?: number): void {
    const payload =
      action === "contribute"
        ? contributionPayload(contributionAmount)
        : action === "fund"
          ? ({ kind: "dare_fund" } as const)
          : action === "accept"
            ? ({ kind: "dare_accept" } as const)
            : action === "decline"
              ? ({ kind: "dare_decline" } as const)
              : ({ kind: "dare_cancel" } as const);
    prepare.mutate(
      {
        guildId: props.guildId,
        dareId: props.dareId,
        expectedRevision: props.revision,
        payload,
        idempotencyKey: globalThis.crypto.randomUUID(),
      },
      {
        onSuccess: (outcome) => {
          if (outcome.kind !== "intent_created") {
            setMessage(outcome.kind.replaceAll("_", " "));
            return;
          }
          setPrepared({
            intentId: outcome.intentId,
            expiresAt: new Date(outcome.expiresAt),
            action: outcome.confirmation.action,
            amount: outcome.confirmation.amount,
            targets: outcome.confirmation.targets,
            irreversible: outcome.confirmation.irreversible,
          });
          setMessage(null);
        },
      },
    );
  }

  function deleteCurrentDraft(): void {
    deleteDraft.mutate(
      {
        guildId: props.guildId,
        dareId: props.dareId,
        expectedRevision: props.revision,
      },
      {
        onSuccess: (outcome) => {
          setMessage(outcome.kind.replaceAll("_", " "));
          invalidateDares();
        },
      },
    );
  }

  return (
    <section className="space-y-3 rounded-lg border border-scout-border p-4">
      <div>
        <h2 className="text-sm font-medium">Available actions</h2>
        <p className="text-xs text-scout-subtle">
          Financial and binding actions require a short-lived confirmation.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {props.availableActions.map((action) =>
          action === "contribute" ? (
            <contributionForm.AppForm key={action}>
              <form
                ref={contributionFormElement}
                className="flex items-end gap-2"
                onSubmit={(event) => {
                  handleFormSubmit(event, () =>
                    contributionForm.handleSubmit(),
                  );
                }}
              >
                <fieldset
                  disabled={prepare.isPending}
                  className="flex items-end gap-2"
                >
                  <contributionForm.AppField name="contributionAmount">
                    {(field) => (
                      <field.TextField
                        id={`dare-${props.dareId.toString()}-contribution`}
                        label="Contribution (BB)"
                        type="number"
                        inputMode="numeric"
                        min={1}
                        step={1}
                        required
                        autoComplete="off"
                        fieldClassName="w-28"
                      />
                    )}
                  </contributionForm.AppField>
                  <Button type="submit" variant="outline">
                    Contribute BB
                  </Button>
                </fieldset>
              </form>
            </contributionForm.AppForm>
          ) : (
            <Button
              key={action}
              type="button"
              variant={
                action === "decline" || action === "cancel"
                  ? "outline"
                  : "default"
              }
              disabled={prepare.isPending || deleteDraft.isPending}
              onClick={() => {
                if (action === "delete_draft") deleteCurrentDraft();
                else prepareAction(action);
              }}
            >
              {action.replaceAll("_", " ")}
            </Button>
          ),
        )}
      </div>
      {prepared !== null && (
        <div className="space-y-2 rounded-md bg-scout-primary/5 p-3 text-sm">
          <p>
            Confirm <strong>{prepared.action}</strong> for{" "}
            {prepared.targets.join(", ")}
            {prepared.amount === null ? "" : ` (${prepared.amount})`}.
          </p>
          <p className="text-xs text-scout-subtle">
            {prepared.irreversible
              ? "This commits a binding or financial change. "
              : ""}
            Expires {prepared.expiresAt.toLocaleTimeString()}.
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={confirm.isPending}
              onClick={() => {
                confirm.mutate(
                  { guildId: props.guildId, intentId: prepared.intentId },
                  {
                    onSuccess: (outcome) => {
                      setMessage(outcome.kind.replaceAll("_", " "));
                      setPrepared(null);
                      invalidateDares();
                    },
                  },
                );
              }}
            >
              {confirm.isPending ? "Confirming…" : "Confirm"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setPrepared(null);
              }}
            >
              Keep unchanged
            </Button>
          </div>
        </div>
      )}
      {message !== null && <p className="text-sm capitalize">{message}</p>}
      {(prepare.error ?? confirm.error ?? deleteDraft.error) !== null && (
        <p className="text-sm text-scout-danger">
          {(prepare.error ?? confirm.error ?? deleteDraft.error)?.message}
        </p>
      )}
    </section>
  );
}
