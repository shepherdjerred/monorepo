import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { RiotIdSchema } from "@scout-for-lol/data";
import { useTRPC } from "#src/lib/trpc.ts";
import { findRegion, type RegionValue } from "#src/lib/regions.ts";
import { Button } from "#src/components/ui/button.tsx";
import { Label } from "#src/components/ui/label.tsx";
import { RegionSelect } from "#src/components/region-select.tsx";
import { RiotIdCombobox } from "#src/components/riot-id-combobox.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#src/components/ui/dialog.tsx";

/** Add a Riot account to an existing player (via `player.addAccount`). */
export function AddAccountDialog(props: {
  guildId: string;
  playerAlias: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: () => void;
}) {
  const trpc = useTRPC();
  const [riotId, setRiotId] = useState("");
  const [region, setRegion] = useState<RegionValue>("AMERICA_NORTH");
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation(
    trpc.player.addAccount.mutationOptions({
      onSuccess: () => {
        props.onAdded();
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
            const parsed = RiotIdSchema.safeParse(riotId);
            if (!parsed.success) {
              setError("Riot ID must be in the form game_name#tag.");
              return;
            }
            mutation.mutate({
              guildId: props.guildId,
              playerAlias: props.playerAlias,
              riotId,
              region,
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>Add account</DialogTitle>
            <DialogDescription>
              Attach a Riot account to &quot;{props.playerAlias}&quot;.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="add-account-dialog-riot">Riot ID</Label>
            <RiotIdCombobox
              id="add-account-dialog-riot"
              guildId={props.guildId}
              region={region}
              value={riotId}
              onValueChange={setRiotId}
              onSelectAccount={({ region: accountRegion }) => {
                const match = findRegion(accountRegion);
                if (match !== null) setRegion(match);
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="add-account-dialog-region">Region</Label>
            <RegionSelect
              id="add-account-dialog-region"
              value={region}
              onValueChange={setRegion}
            />
          </div>

          {error !== null && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                props.onOpenChange(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Adding…" : "Add"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
