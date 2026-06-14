import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { RiotIdSchema } from "@scout-for-lol/data";
import { useTRPC } from "#src/lib/trpc.ts";
import type { RegionValue } from "#src/lib/regions.ts";
import { Button } from "#src/components/ui/button.tsx";
import { RegionSelect } from "#src/components/region-select.tsx";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#src/components/ui/select.tsx";

type Channel = { id: string; name: string };

type Props = {
  guildId: string;
  channels: Channel[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: () => void;
};

export function AddSubscriptionDialog(props: Props) {
  const trpc = useTRPC();
  const [channelId, setChannelId] = useState(props.channels[0]?.id ?? "");
  const [region, setRegion] = useState<RegionValue>("AMERICA_NORTH");
  const [riotIdInput, setRiotIdInput] = useState("");
  const [alias, setAlias] = useState("");
  const [discordUserId, setDiscordUserId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation(
    trpc.subscription.add.mutationOptions({
      onSuccess: (result) => {
        switch (result.kind) {
          case "created":
          case "subscription-already-exists":
            props.onAdded();
            return;
          case "account-already-subscribed":
            setError(
              `That account is already subscribed under "${result.existingPlayerAlias}".`,
            );
            return;
          case "subscription-limit-reached":
            setError(
              `Subscription limit reached (${result.current.toString()}/${result.max.toString()}).`,
            );
            return;
          case "account-limit-reached":
            setError(
              `Account limit reached (${result.current.toString()}/${result.max.toString()}).`,
            );
            return;
          case "riot-id-not-found":
            setError(`Riot ID not found: ${result.message}`);
            return;
          case "internal-error":
            setError(result.message);
            return;
        }
      },
      onError: (err) => {
        setError(err.message);
      },
    }),
  );

  function handleSubmit(event: React.SyntheticEvent) {
    event.preventDefault();
    setError(null);
    // Same schema the backend uses; reusing it keeps the contract
    // single-sourced. We only need the input-side validation here; the
    // server re-parses + transforms on receipt.
    const riotIdParse = RiotIdSchema.safeParse(riotIdInput);
    if (!riotIdParse.success) {
      setError("Riot ID must be in the form game_name#tag");
      return;
    }
    mutation.mutate({
      guildId: props.guildId,
      channelId,
      region,
      riotId: riotIdInput,
      alias: alias.trim(),
      ...(discordUserId.length > 0 && { discordUserId }),
    });
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Add subscription</DialogTitle>
            <DialogDescription>
              Subscribe a player&apos;s Riot ID to a Discord channel.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="add-sub-channel">Channel</Label>
            <Select value={channelId} onValueChange={setChannelId} required>
              <SelectTrigger id="add-sub-channel">
                <SelectValue placeholder="Pick a channel" />
              </SelectTrigger>
              <SelectContent>
                {props.channels.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    #{c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="add-sub-region">Region</Label>
            <RegionSelect
              id="add-sub-region"
              value={region}
              onValueChange={setRegion}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="add-sub-riot-id">
              Riot ID <span className="text-muted-foreground">(name#TAG)</span>
            </Label>
            <Input
              id="add-sub-riot-id"
              value={riotIdInput}
              onChange={(e) => {
                setRiotIdInput(e.target.value);
              }}
              placeholder="example#NA1"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="add-sub-alias">Alias</Label>
            <Input
              id="add-sub-alias"
              value={alias}
              onChange={(e) => {
                setAlias(e.target.value);
              }}
              placeholder="How it shows up in Scout"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="add-sub-discord">
              Discord user ID{" "}
              <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="add-sub-discord"
              value={discordUserId}
              onChange={(e) => {
                setDiscordUserId(e.target.value);
              }}
              placeholder="123456789012345678"
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
