import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTRPC } from "#src/lib/trpc.ts";
import type { RegionValue } from "#src/lib/regions.ts";
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
  const [toPlayerAlias, setToPlayerAlias] = useState("");
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation(
    trpc.player.transferAccount.mutationOptions({
      onSuccess: (result) => {
        props.onTransferred(result.toPlayerAlias);
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
            const target = toPlayerAlias.trim();
            if (target.length === 0) {
              setError("Pick a target player.");
              return;
            }
            mutation.mutate({
              guildId: props.guildId,
              riotId: props.account.riotId,
              region: props.account.region,
              toPlayerAlias: target,
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>Transfer account</DialogTitle>
            <DialogDescription>
              Move {props.account.riotId} to another player.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="transfer-target">Transfer to</Label>
            <PlayerAliasCombobox
              id="transfer-target"
              guildId={props.guildId}
              value={toPlayerAlias}
              onChange={setToPlayerAlias}
            />
          </div>

          <DialogFormError error={error} />

          <DialogFormFooter
            pending={mutation.isPending}
            submitLabel="Transfer"
            pendingLabel="Transferring…"
            onCancel={() => {
              props.onOpenChange(false);
            }}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}
