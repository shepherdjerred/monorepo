import { useMutation } from "@tanstack/react-query";
import { LogOutIcon, UserPlusIcon, UsersIcon } from "lucide-react";
import { toast } from "sonner";
import type { CustomNightSnapshot } from "@scout-for-lol/data";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { AvailabilityPanel } from "@/components/availability-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GamePanel } from "@/components/game-panel";
import { ManagePlayers } from "@/components/manage-players";
import { Progress } from "@/components/ui/progress";
import { RecruitingPanel } from "@/components/recruiting-panel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useActivitySession } from "@/lib/activity-session";
import { useTRPC } from "@/lib/activity-api";
import {
  mutationErrorText,
  useApplyCustomSnapshot,
} from "@/hooks/use-custom-snapshot";

export function CustomsDashboard({
  snapshot,
}: {
  snapshot: CustomNightSnapshot;
}) {
  const session = useActivitySession();
  const participant = snapshot.participants.find(
    (candidate) => candidate.discordId === session.identity.id,
  );
  if (participant === undefined)
    throw new Error("Joined Activity user is missing from the night");
  const trpc = useTRPC();
  const applySnapshot = useApplyCustomSnapshot();
  const end = useMutation(trpc.customs.endNight.mutationOptions());
  const hostControl =
    snapshot.hostDiscordId === participant.discordId ||
    snapshot.cohostDiscordIds.includes(participant.discordId) ||
    participant.role === "ADMIN";
  const canDelegateCohosts =
    snapshot.hostDiscordId === participant.discordId ||
    participant.role === "ADMIN";
  const endNight = async () => {
    try {
      applySnapshot(
        await end.mutateAsync({
          nightId: snapshot.id,
          expectedRevision: snapshot.revision,
        }),
      );
    } catch (error) {
      toast.error(mutationErrorText(error));
    }
  };
  return (
    <main className="mx-auto min-h-dvh w-full max-w-6xl space-y-4 p-3 sm:p-5">
      <header className="rounded-xl bg-activity-surface p-4 ring-1 ring-activity-ink/10">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-heading text-xl font-semibold">
                {snapshot.guildName} Customs
              </h1>
              <Badge variant="secondary">{snapshot.state}</Badge>
            </div>
            <p className="mt-1 text-sm text-activity-muted-ink">
              {snapshot.recruitmentCounts.ready.toString()}/10 ready ·{" "}
              {snapshot.recruitmentCounts.maybe.toString()} maybe ·{" "}
              {snapshot.recruitmentCounts.away.toString()} away
            </p>
          </div>
          <div className="activity-layout-header-actions flex flex-wrap gap-2">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="outline"
                    onClick={() => void session.sdk.invite()}
                  />
                }
              >
                <UserPlusIcon /> Invite
              </TooltipTrigger>
              <TooltipContent>
                Invite Discord members into this Activity
              </TooltipContent>
            </Tooltip>
            <Badge variant="outline" className="h-8 px-3">
              <UsersIcon /> {session.connectedParticipantCount.toString()}{" "}
              viewing
            </Badge>
            {hostControl && (
              <ManagePlayers
                canDelegateCohosts={canDelegateCohosts}
                snapshot={snapshot}
              />
            )}
          </div>
        </div>
        <Progress
          className="mt-4"
          value={snapshot.recruitmentCounts.ready * 10}
        />
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.55fr)]">
        <div className="activity-layout-secondary space-y-4">
          {snapshot.currentGame === null ? (
            hostControl ? (
              <RecruitingPanel snapshot={snapshot} />
            ) : (
              <div className="rounded-xl border p-6 text-center text-sm text-activity-muted-ink">
                Waiting for the host to choose the roster.
              </div>
            )
          ) : hostControl && snapshot.state === "INTERMISSION" ? (
            <Tabs defaultValue="next-game">
              <TabsList aria-label="Intermission controls">
                <TabsTrigger value="next-game">Next game</TabsTrigger>
                <TabsTrigger value="roster">Change roster</TabsTrigger>
              </TabsList>
              <TabsContent value="next-game">
                <GamePanel snapshot={snapshot} hostControl={hostControl} />
              </TabsContent>
              <TabsContent value="roster">
                <RecruitingPanel snapshot={snapshot} />
              </TabsContent>
            </Tabs>
          ) : (
            <GamePanel snapshot={snapshot} hostControl={hostControl} />
          )}
        </div>
        <div className="space-y-4">
          <AvailabilityPanel snapshot={snapshot} participant={participant} />
          {hostControl && (
            <AlertDialog>
              <AlertDialogTrigger
                render={<Button className="w-full" variant="destructive" />}
              >
                <LogOutIcon /> End night
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>End this custom night?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Scout will move players back to the selected lobby and
                    delete only this night’s recorded team channels.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep playing</AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    onClick={() => void endNight()}
                  >
                    End night
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>
    </main>
  );
}
