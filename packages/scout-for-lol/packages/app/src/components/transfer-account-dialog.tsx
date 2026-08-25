import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTRPC } from "#src/lib/trpc.ts";
import { analyticsMeta } from "#src/lib/analytics.ts";
import type { RegionValue } from "#src/lib/regions.ts";
import { Dialog } from "@scout-for-lol/design-system/components/dialog";
import { SemanticDialogForm } from "#src/components/dialog-form.tsx";
import {
  PlayerAliasFormField,
  usePlayerAliasDialogForm,
} from "#src/components/player-alias-form-field.tsx";
import { PlayerAliasFormSchema } from "#src/lib/form-schemas.ts";

/**
 * Transfer an account to another player (via `player.transferAccount`). The
 * account is identified by its resolved Riot ID + region (same keying as the
 * inline Delete action).
 */
export function TransferAccountDialog(props: {
  guildId: string;
  account: { riotId: string; region: RegionValue };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTransferred: (toPlayerAlias: string) => void;
}) {
  const trpc = useTRPC();
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation(
    trpc.player.transferAccount.mutationOptions({
      meta: analyticsMeta("player_account_transferred"),
      onSuccess: (result) => {
        props.onTransferred(result.toPlayerAlias);
      },
      onError: (err) => {
        setError(err.message);
      },
    }),
  );
  const { form, formElement } = usePlayerAliasDialogForm(
    props.open,
    PlayerAliasFormSchema,
    (toPlayerAlias) => {
      setError(null);
      mutation.mutate({
        guildId: props.guildId,
        riotId: props.account.riotId,
        region: props.account.region,
        toPlayerAlias,
      });
    },
  );

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <form.AppForm>
        <SemanticDialogForm
          formRef={formElement}
          title="Transfer account"
          description={<>Move {props.account.riotId} to another player.</>}
          pending={mutation.isPending}
          pendingStatus="Transferring account…"
          error={error}
          submitLabel="Transfer"
          pendingLabel="Transferring…"
          onSubmit={() => form.handleSubmit()}
          onCancel={() => {
            setError(null);
            form.reset({ alias: "" });
            props.onOpenChange(false);
          }}
        >
          <form.AppField name="alias">
            {(field) => (
              <PlayerAliasFormField
                id="transfer-target"
                label="Transfer to"
                guildId={props.guildId}
                field={field}
              />
            )}
          </form.AppField>
        </SemanticDialogForm>
      </form.AppForm>
    </Dialog>
  );
}
