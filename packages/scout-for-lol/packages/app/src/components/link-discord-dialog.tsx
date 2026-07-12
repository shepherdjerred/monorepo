import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTRPC } from "#src/lib/trpc.ts";
import { DiscordMemberCombobox } from "#src/components/discord-member-combobox.tsx";
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

/** Link a Discord user to a player (via `player.linkDiscord`). */
export function LinkDiscordDialog(props: {
  guildId: string;
  playerAlias: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLinked: () => void;
}) {
  const trpc = useTRPC();
  const [discordUserId, setDiscordUserId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation(
    trpc.player.linkDiscord.mutationOptions({
      onSuccess: () => {
        props.onLinked();
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
            if (discordUserId.length === 0) {
              setError("Pick a Discord user.");
              return;
            }
            mutation.mutate({
              guildId: props.guildId,
              playerAlias: props.playerAlias,
              discordUserId,
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>Link Discord user</DialogTitle>
            <DialogDescription>
              Link a Discord user to &quot;{props.playerAlias}&quot;.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="link-discord-dialog-user">Discord user</Label>
            <DiscordMemberCombobox
              id="link-discord-dialog-user"
              guildId={props.guildId}
              value={discordUserId}
              onChange={setDiscordUserId}
            />
          </div>

          <DialogFormError error={error} />

          <DialogFormFooter
            pending={mutation.isPending}
            submitLabel="Link"
            pendingLabel="Linking…"
            submitDisabled={discordUserId.length === 0}
            onCancel={() => {
              props.onOpenChange(false);
            }}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}
