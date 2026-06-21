import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTRPC } from "#src/lib/trpc.ts";
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

export function RenamePlayerDialog(props: {
  guildId: string;
  currentAlias: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRenamed: (newAlias: string) => void;
}) {
  const trpc = useTRPC();
  const [newAlias, setNewAlias] = useState(props.currentAlias);
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation(
    trpc.player.renamePlayer.mutationOptions({
      onSuccess: (result) => {
        props.onRenamed(result.alias);
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
            const trimmed = newAlias.trim();
            if (trimmed.length === 0) {
              setError("New alias is required.");
              return;
            }
            mutation.mutate({
              guildId: props.guildId,
              currentAlias: props.currentAlias,
              newAlias: trimmed,
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>Rename player</DialogTitle>
            <DialogDescription>
              Rename &quot;{props.currentAlias}&quot;.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="rename-player-new">New alias</Label>
            <Input
              id="rename-player-new"
              value={newAlias}
              onChange={(event) => {
                setNewAlias(event.target.value);
              }}
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
              {mutation.isPending ? "Renaming…" : "Rename"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
