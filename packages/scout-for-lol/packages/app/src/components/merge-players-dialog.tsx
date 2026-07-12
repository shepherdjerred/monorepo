import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTRPC } from "#src/lib/trpc.ts";
import { PlayerAliasCombobox } from "#src/components/player-alias-combobox.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "#src/components/ui/dialog.tsx";
import { Label } from "#src/components/ui/label.tsx";
import {
  DialogFormError,
  DialogFormFooter,
} from "#src/components/dialog-form.tsx";

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
  const [targetAlias, setTargetAlias] = useState("");
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation(
    trpc.player.mergePlayers.mutationOptions({
      onSuccess: (result) => {
        props.onMerged(result.targetAlias);
      },
      onError: (err) => {
        setError(err.message);
      },
    }),
  );

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            const target = targetAlias.trim();
            if (target.length === 0) {
              setError("Pick a target player.");
              return;
            }
            if (target === props.sourceAlias) {
              setError("Source and target are the same player.");
              return;
            }
            mutation.mutate({
              guildId: props.guildId,
              sourceAlias: props.sourceAlias,
              targetAlias: target,
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>Merge player</DialogTitle>
            <DialogDescription>
              Merge &quot;{props.sourceAlias}&quot; into another player. This
              moves its accounts and deletes &quot;{props.sourceAlias}&quot;.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="merge-target">Merge into</Label>
            <PlayerAliasCombobox
              id="merge-target"
              guildId={props.guildId}
              value={targetAlias}
              onChange={setTargetAlias}
            />
          </div>

          <DialogFormError error={error} />

          <DialogFormFooter
            pending={mutation.isPending}
            submitLabel="Merge"
            pendingLabel="Merging…"
            submitVariant="destructive"
            onCancel={() => {
              props.onOpenChange(false);
            }}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}
