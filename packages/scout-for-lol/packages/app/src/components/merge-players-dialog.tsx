import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTRPC } from "#src/lib/trpc.ts";
import { analyticsMeta } from "#src/lib/analytics.ts";
import { Dialog } from "@scout-for-lol/design-system/components/dialog";
import { SemanticDialogForm } from "#src/components/dialog-form.tsx";
import {
  PlayerAliasFormField,
  usePlayerAliasDialogForm,
} from "#src/components/player-alias-form-field.tsx";
import { PlayerAliasFormSchema } from "#src/lib/form-schemas.ts";

/**
 * Merge the current player into another player (via `player.mergePlayers`).
 * The current player is the source and is deleted; its accounts/subscriptions
 * move to the target.
 */
export function MergePlayersDialog(props: {
  guildId: string;
  sourceAlias: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMerged: (targetAlias: string) => void;
}) {
  const trpc = useTRPC();
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation(
    trpc.player.mergePlayers.mutationOptions({
      meta: analyticsMeta("players_merged"),
      onSuccess: (result) => {
        props.onMerged(result.targetAlias);
      },
      onError: (err) => {
        setError(err.message);
      },
    }),
  );
  const schema = PlayerAliasFormSchema.refine(
    (value) => value.alias !== props.sourceAlias,
    { path: ["alias"], message: "Pick a different player." },
  );
  const { form, formElement } = usePlayerAliasDialogForm(
    props.open,
    schema,
    (targetAlias) => {
      setError(null);
      mutation.mutate({
        guildId: props.guildId,
        sourceAlias: props.sourceAlias,
        targetAlias,
      });
    },
  );

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <form.AppForm>
        <SemanticDialogForm
          formRef={formElement}
          title="Merge player"
          description={
            <>
              Merge &quot;{props.sourceAlias}&quot; into another player. This
              moves its accounts and deletes &quot;{props.sourceAlias}&quot;.
            </>
          }
          pending={mutation.isPending}
          pendingStatus="Merging players…"
          error={error}
          submitLabel="Merge"
          pendingLabel="Merging…"
          submitVariant="destructive"
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
                id="merge-target"
                label="Merge into"
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
