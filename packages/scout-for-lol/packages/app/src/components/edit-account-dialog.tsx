import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTRPC } from "#src/lib/trpc.ts";
import { findRegion, type RegionValue } from "#src/lib/regions.ts";
import { Button } from "#src/components/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#src/components/ui/dialog.tsx";
import { Input } from "#src/components/ui/input.tsx";
import { Label } from "#src/components/ui/label.tsx";
import { RegionSelect } from "#src/components/region-select.tsx";

/**
 * Edit an existing account's alias and region in place (via
 * `player.updateAccount`). Region changes re-resolve the cached Riot ID
 * server-side.
 */
export function EditAccountDialog(props: {
  guildId: string;
  account: { id: number; alias: string; region: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const trpc = useTRPC();
  const [alias, setAlias] = useState(props.account.alias);
  const [region, setRegion] = useState<RegionValue>(
    findRegion(props.account.region) ?? "AMERICA_NORTH",
  );
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation(
    trpc.player.updateAccount.mutationOptions({
      onSuccess: () => {
        props.onSaved();
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
            const trimmed = alias.trim();
            if (trimmed.length === 0) {
              setError("Alias is required.");
              return;
            }
            mutation.mutate({
              guildId: props.guildId,
              accountId: props.account.id,
              alias: trimmed,
              region,
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>Edit account</DialogTitle>
            <DialogDescription>
              Update the account&apos;s alias and region.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="edit-account-alias">Alias</Label>
            <Input
              id="edit-account-alias"
              value={alias}
              onChange={(event) => {
                setAlias(event.target.value);
              }}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-account-region">Region</Label>
            <RegionSelect
              id="edit-account-region"
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
              {mutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
