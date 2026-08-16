import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import type { CustomNightSnapshot } from "@scout-for-lol/data";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NightPlayerCard } from "@/components/player-card";
import { ResponsiveOverlay } from "@/components/responsive-overlay";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTRPC } from "@/lib/activity-api";
import {
  mutationErrorText,
  useApplyCustomSnapshot,
} from "@/hooks/use-custom-snapshot";

export function ManagePlayers({
  canDelegateCohosts,
  snapshot,
}: {
  canDelegateCohosts: boolean;
  snapshot: CustomNightSnapshot;
}) {
  const trpc = useTRPC();
  const applySnapshot = useApplyCustomSnapshot();
  const held = useMutation(trpc.customs.setHeld.mutationOptions());
  const cohost = useMutation(trpc.customs.setCohost.mutationOptions());
  const run = async (operation: Promise<{ snapshot: CustomNightSnapshot }>) => {
    try {
      applySnapshot(await operation);
    } catch (error) {
      toast.error(mutationErrorText(error));
    }
  };
  return (
    <ResponsiveOverlay
      label="Manage players"
      title="Night participants"
      description="Hold away slots or delegate cohost control."
    >
      <ScrollArea className="max-h-[60dvh] pr-2">
        <div className="space-y-3">
          {snapshot.participants.map((participant) => {
            const isCohost = snapshot.cohostDiscordIds.includes(
              participant.discordId,
            );
            const revision = {
              nightId: snapshot.id,
              expectedRevision: snapshot.revision,
            };
            return (
              <div key={participant.discordId} className="space-y-2">
                <NightPlayerCard participant={participant} />
                <div className="flex flex-wrap items-center gap-2 pl-2">
                  <Badge variant="secondary">
                    {participant.availability.replaceAll("_", " ")}
                  </Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void run(
                        held.mutateAsync({
                          ...revision,
                          discordId: participant.discordId,
                          held: !participant.held,
                        }),
                      )
                    }
                  >
                    {participant.held ? "Release hold" : "Hold slot"}
                  </Button>
                  {canDelegateCohosts &&
                    participant.discordId !== snapshot.hostDiscordId && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          void run(
                            cohost.mutateAsync({
                              ...revision,
                              discordId: participant.discordId,
                              cohost: !isCohost,
                            }),
                          )
                        }
                      >
                        {isCohost ? "Remove cohost" : "Make cohost"}
                      </Button>
                    )}
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </ResponsiveOverlay>
  );
}
