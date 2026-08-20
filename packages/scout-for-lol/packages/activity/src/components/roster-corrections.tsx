import { useMutation } from "@tanstack/react-query";
import { Button } from "@scout-for-lol/design-system/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@scout-for-lol/design-system/components/select";
import { toast } from "@scout-for-lol/design-system/components/toaster";
import { useState } from "react";
import type { CustomNightSnapshot } from "@scout-for-lol/data";
import { ResponsiveOverlay } from "@/components/responsive-overlay";
import { useTRPC } from "@/lib/activity-api";
import {
  mutationErrorText,
  useApplyCustomSnapshot,
} from "@/hooks/use-custom-snapshot";

export function RosterCorrections({
  snapshot,
}: {
  snapshot: CustomNightSnapshot;
}) {
  const game = snapshot.currentGame;
  const trpc = useTRPC();
  const applySnapshot = useApplyCustomSnapshot();
  const substitute = useMutation(trpc.customs.substitute.mutationOptions());
  const [outgoingDiscordId, setOutgoingDiscordId] = useState<string | null>(
    null,
  );
  const [incomingDiscordId, setIncomingDiscordId] = useState<string | null>(
    null,
  );
  if (game === null) return null;
  const rosterIds = new Set(
    game.participants.map((participant) => participant.discordId),
  );
  const bench = snapshot.participants.filter(
    (participant) =>
      !rosterIds.has(participant.discordId) &&
      (participant.held ||
        (participant.availability === "READY" &&
          participant.awayUntil === null &&
          !participant.awayOverdue)),
  );
  const submit = async () => {
    if (outgoingDiscordId === null || incomingDiscordId === null) {
      toast.error("Choose both the outgoing and incoming player.");
      return;
    }
    try {
      await applySnapshot(() =>
        substitute.mutateAsync({
          nightId: snapshot.id,
          expectedRevision: snapshot.revision,
          outgoingDiscordId,
          incomingDiscordId,
        }),
      );
    } catch (error) {
      toast.error(mutationErrorText(error));
    }
  };
  return (
    <ResponsiveOverlay
      label="Substitute player"
      title="Roster substitution"
      description="Substitutions are available before team lock. Undo draft picks first."
    >
      <div className="space-y-4">
        <div className="grid gap-2 text-sm font-medium">
          <span id="outgoing-player-label">Outgoing player</span>
          <Select
            value={outgoingDiscordId ?? ""}
            onValueChange={setOutgoingDiscordId}
          >
            <SelectTrigger
              className="w-full"
              aria-labelledby="outgoing-player-label"
            >
              <SelectValue placeholder="Choose player" />
            </SelectTrigger>
            <SelectContent>
              {game.participants.map((participant) => (
                <SelectItem
                  key={participant.discordId}
                  value={participant.discordId}
                >
                  {participant.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2 text-sm font-medium">
          <span id="incoming-player-label">Incoming player</span>
          <Select
            value={incomingDiscordId ?? ""}
            onValueChange={setIncomingDiscordId}
          >
            <SelectTrigger
              className="w-full"
              aria-labelledby="incoming-player-label"
            >
              <SelectValue placeholder="Choose ready bench player" />
            </SelectTrigger>
            <SelectContent>
              {bench.map((participant) => (
                <SelectItem
                  key={participant.discordId}
                  value={participant.discordId}
                >
                  {participant.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          className="w-full"
          disabled={substitute.isPending || bench.length === 0}
          onClick={() => void submit()}
        >
          Confirm substitution
        </Button>
      </div>
    </ResponsiveOverlay>
  );
}
