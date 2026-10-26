import type { DiscordGuildId } from "@scout-for-lol/data";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@scout-for-lol/design-system/components/button";
import { useTRPC } from "#src/lib/query/trpc.ts";

type PreparedAction = {
  intentId: string;
  expiresAt: Date;
  action: string;
  targets: string[];
  irreversible: boolean;
};

export function DareActions(props: {
  guildId: DiscordGuildId;
  dareId: number;
  revision: number;
  availableActions: string[];
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [prepared, setPrepared] = useState<PreparedAction | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const prepare = useMutation(trpc.dares.darePrepareAction.mutationOptions());
  const confirm = useMutation(trpc.dares.dareConfirmAction.mutationOptions());
  const deleteDraft = useMutation(trpc.dares.dareDeleteDraft.mutationOptions());
  if (props.availableActions.length === 0) return null;

  function invalidateDares(): void {
    void queryClient.invalidateQueries({
      queryKey: trpc.dares.dareList.pathKey(),
    });
    void queryClient.invalidateQueries({
      queryKey: trpc.dares.dareInspect.pathKey(),
    });
    void queryClient.invalidateQueries({
      queryKey: trpc.dares.dareEvidence.pathKey(),
    });
  }

  function prepareAction(action: string): void {
    const payload =
      action === "publish"
        ? ({ kind: "dare_publish" } as const)
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
          Binding actions require a short-lived confirmation.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {props.availableActions.map((action) => (
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
        ))}
      </div>
      {prepared !== null && (
        <div className="space-y-2 rounded-md bg-scout-primary/5 p-3 text-sm">
          <p>
            Confirm <strong>{prepared.action}</strong> for Dare #{props.dareId}.
            {prepared.targets.length > 0 &&
              ` Targets: ${prepared.targets.join(", ")}.`}
          </p>
          <p className="text-xs text-scout-subtle">
            {prepared.irreversible ? "This commits a binding change. " : ""}
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
