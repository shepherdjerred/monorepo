import { useMutation } from "@tanstack/react-query";
import {
  CheckIcon,
  ClipboardIcon,
  RotateCcwIcon,
  Volume2Icon,
} from "lucide-react";
import { toast } from "sonner";
import type {
  CustomIntermissionChoice,
  CustomNightSnapshot,
} from "@scout-for-lol/data";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DraftPlayerCard } from "@/components/player-card";
import { Separator } from "@/components/ui/separator";
import { RosterCorrections } from "@/components/roster-corrections";
import { useActivitySession } from "@/lib/activity-session";
import { useTRPC } from "@/lib/activity-api";
import {
  mutationErrorText,
  useApplyCustomSnapshot,
} from "@/hooks/use-custom-snapshot";

const intermissionOptions: readonly {
  choice: CustomIntermissionChoice;
  label: string;
}[] = [
  { choice: "KEEP_TEAMS_AND_CAPTAINS", label: "Keep teams and captains" },
  {
    choice: "KEEP_TEAMS_REROLL_CAPTAINS",
    label: "Keep teams, reroll captains",
  },
  { choice: "REDRAFT_SAME_CAPTAINS", label: "Redraft, same captains" },
  { choice: "REDRAFT_NEW_CAPTAINS", label: "Redraft, new captains" },
];

export function GamePanel({
  snapshot,
  hostControl,
}: {
  snapshot: CustomNightSnapshot;
  hostControl: boolean;
}) {
  const game = snapshot.currentGame;
  if (game === null) throw new Error("GamePanel requires a current game");
  return snapshot.state === "INTERMISSION" ? (
    <IntermissionPanel snapshot={snapshot} hostControl={hostControl} />
  ) : (
    <ActiveGamePanel snapshot={snapshot} hostControl={hostControl} />
  );
}

function IntermissionPanel({
  snapshot,
  hostControl,
}: {
  snapshot: CustomNightSnapshot;
  hostControl: boolean;
}) {
  const game = snapshot.currentGame;
  if (game === null)
    throw new Error("IntermissionPanel requires a current game");
  const trpc = useTRPC();
  const applySnapshot = useApplyCustomSnapshot();
  const continueNight = useMutation(
    trpc.customs.continueNight.mutationOptions(),
  );
  const run = async (operation: Promise<{ snapshot: CustomNightSnapshot }>) => {
    try {
      applySnapshot(await operation);
    } catch (error) {
      toast.error(mutationErrorText(error));
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Game {game.sequence} complete</CardTitle>
        <CardDescription>
          {game.resultSource === "MANUAL" ? "Manual result" : "Riot verified"} ·
          Team {game.winner} won
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2">
        {game.repeatChampionWarnings.length > 0 && (
          <div className="col-span-full rounded-lg border border-activity-danger/40 p-3 text-sm">
            {game.repeatChampionWarnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </div>
        )}
        {intermissionOptions.map((option) => (
          <Button
            key={option.choice}
            variant="outline"
            disabled={!hostControl || continueNight.isPending}
            onClick={() =>
              void run(
                continueNight.mutateAsync({
                  nightId: snapshot.id,
                  expectedRevision: snapshot.revision,
                  choice: option.choice,
                }),
              )
            }
          >
            {option.label}
          </Button>
        ))}
      </CardContent>
    </Card>
  );
}

function ActiveGamePanel({
  snapshot,
  hostControl,
}: {
  snapshot: CustomNightSnapshot;
  hostControl: boolean;
}) {
  const game = snapshot.currentGame;
  if (game === null) throw new Error("ActiveGamePanel requires a current game");
  const trpc = useTRPC();
  const applySnapshot = useApplyCustomSnapshot();
  const captains = useMutation(trpc.customs.selectCaptains.mutationOptions());
  const retryVoice = useMutation(trpc.customs.retryVoice.mutationOptions());
  const overrideVoice = useMutation(
    trpc.customs.overrideVoice.mutationOptions(),
  );
  const retryCode = useMutation(
    trpc.customs.retryTournamentCode.mutationOptions(),
  );
  const start = useMutation(trpc.customs.startGame.mutationOptions());
  const result = useMutation(trpc.customs.manualResult.mutationOptions());
  const run = async (operation: Promise<{ snapshot: CustomNightSnapshot }>) => {
    try {
      applySnapshot(await operation);
    } catch (error) {
      toast.error(mutationErrorText(error));
    }
  };
  const revision = {
    nightId: snapshot.id,
    expectedRevision: snapshot.revision,
  };
  const teamsComplete = game.participants.every(
    (participant) => participant.team !== null,
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>Game {game.sequence}</CardTitle>
            <CardDescription>
              {game.map.replaceAll("_", " ")} ·{" "}
              {game.pickMode.replaceAll("_", " ")}
            </CardDescription>
          </div>
          <Badge variant="secondary">{game.state.replaceAll("_", " ")}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {game.state === "ROSTER_OPEN" && (
          <Button
            className="w-full"
            disabled={!hostControl || captains.isPending}
            onClick={() => void run(captains.mutateAsync(revision))}
          >
            Select random captains and sides
          </Button>
        )}

        {(game.state === "DRAFTING" || teamsComplete) && (
          <DraftSection snapshot={snapshot} hostControl={hostControl} />
        )}

        {game.state === "CODE_PENDING" && (
          <div className="rounded-lg border border-activity-danger/40 p-4">
            <p className="text-sm">
              Tournament code creation is pending or failed.
            </p>
            <Button
              className="mt-3"
              variant="outline"
              disabled={!hostControl}
              onClick={() => void run(retryCode.mutateAsync(revision))}
            >
              Retry Tournament code
            </Button>
          </div>
        )}

        {game.tournamentCode !== null && (
          <div className="space-y-3 rounded-lg bg-activity-subtle p-4 text-center">
            <p className="text-xs uppercase tracking-wide text-activity-muted-ink">
              Tournament code
            </p>
            <code className="block break-all text-lg font-semibold">
              {game.tournamentCode}
            </code>
            <Button
              variant="outline"
              onClick={() => {
                void navigator.clipboard.writeText(game.tournamentCode ?? "");
                toast.success("Tournament code copied");
              }}
            >
              <ClipboardIcon /> Copy code
            </Button>
          </div>
        )}

        {!game.voiceReady &&
          !game.voiceOverride &&
          (game.state === "CODE_PENDING" || game.state === "LOBBY_READY") && (
            <div className="rounded-lg border border-activity-danger/40 p-4 text-sm">
              <p className="font-medium">Voice needs attention</p>
              <p className="mt-1 text-activity-muted-ink">
                {game.voiceError ??
                  "Voice arrangement did not finish for this revision."}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={!hostControl}
                  onClick={() => void run(retryVoice.mutateAsync(revision))}
                >
                  <Volume2Icon /> Retry voice
                </Button>
                <Button
                  variant="outline"
                  disabled={!hostControl}
                  onClick={() => void run(overrideVoice.mutateAsync(revision))}
                >
                  Continue after arranging manually
                </Button>
              </div>
            </div>
          )}

        {game.state === "LOBBY_READY" && (
          <Button
            className="w-full"
            disabled={!hostControl || (!game.voiceReady && !game.voiceOverride)}
            onClick={() => void run(start.mutateAsync(revision))}
          >
            Mark game started
          </Button>
        )}

        {(game.state === "PLAYING" || game.state === "RESULT_PENDING") &&
          hostControl && (
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                onClick={() =>
                  void run(result.mutateAsync({ ...revision, winner: "A" }))
                }
              >
                Team A won
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  void run(result.mutateAsync({ ...revision, winner: "B" }))
                }
              >
                Team B won
              </Button>
            </div>
          )}
      </CardContent>
    </Card>
  );
}

function DraftSection({
  snapshot,
  hostControl,
}: {
  snapshot: CustomNightSnapshot;
  hostControl: boolean;
}) {
  const game = snapshot.currentGame;
  if (game === null) throw new Error("DraftSection requires a current game");
  const session = useActivitySession();
  const trpc = useTRPC();
  const applySnapshot = useApplyCustomSnapshot();
  const rerollCaptains = useMutation(
    trpc.customs.rerollCaptains.mutationOptions(),
  );
  const pick = useMutation(trpc.customs.pick.mutationOptions());
  const undo = useMutation(trpc.customs.undoPick.mutationOptions());
  const lock = useMutation(trpc.customs.lockTeams.mutationOptions());
  const run = async (operation: Promise<{ snapshot: CustomNightSnapshot }>) => {
    try {
      applySnapshot(await operation);
    } catch (error) {
      toast.error(mutationErrorText(error));
    }
  };
  const revision = {
    nightId: snapshot.id,
    expectedRevision: snapshot.revision,
  };
  const activeCaptain = game.participants.find(
    (participant) =>
      participant.captain && participant.team === game.activeCaptain,
  );
  const canPick = activeCaptain?.discordId === session.identity.id;
  const activeCaptainLabel =
    activeCaptain?.displayName ??
    (game.activeCaptain === null
      ? "the active captain"
      : `Team ${game.activeCaptain}`);
  const unpicked = game.participants.filter(
    (participant) => !participant.captain && participant.team === null,
  );
  const teamsComplete = game.participants.every(
    (participant) => participant.team !== null,
  );
  return (
    <>
      {game.state === "DRAFTING" && (
        <div className="rounded-lg bg-activity-subtle p-3 text-center text-sm">
          {canPick
            ? "Your pick—choose a player"
            : `Waiting for ${activeCaptainLabel} to pick`}
        </div>
      )}
      <div className="grid gap-3 lg:grid-cols-[1fr_auto_1fr]">
        <TeamColumn snapshot={snapshot} team="A" />
        <Separator className="hidden lg:block" orientation="vertical" />
        <TeamColumn snapshot={snapshot} team="B" />
      </div>
      {unpicked.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-activity-muted-ink">
            Available
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {unpicked.map((participant) => (
              <DraftPlayerCard
                key={participant.discordId}
                participant={participant}
                canPick={canPick && !pick.isPending}
                onPick={() =>
                  void run(
                    pick.mutateAsync({
                      ...revision,
                      discordId: participant.discordId,
                    }),
                  )
                }
              />
            ))}
          </div>
        </div>
      )}
      <DraftHostControls
        snapshot={snapshot}
        hostControl={hostControl}
        teamsComplete={teamsComplete}
        onUndo={() => void run(undo.mutateAsync(revision))}
        onReroll={() => void run(rerollCaptains.mutateAsync(revision))}
        onLock={() => void run(lock.mutateAsync(revision))}
      />
    </>
  );
}

function DraftHostControls({
  snapshot,
  hostControl,
  teamsComplete,
  onUndo,
  onReroll,
  onLock,
}: {
  snapshot: CustomNightSnapshot;
  hostControl: boolean;
  teamsComplete: boolean;
  onUndo: () => void;
  onReroll: () => void;
  onLock: () => void;
}) {
  const game = snapshot.currentGame;
  if (game === null)
    throw new Error("DraftHostControls requires a current game");
  const hasPicks = game.participants.some(
    (participant) => participant.pickOrder !== null,
  );
  if (!hostControl) return null;
  return (
    <>
      {hasPicks && game.state === "DRAFTING" && (
        <Button variant="outline" onClick={onUndo}>
          <RotateCcwIcon /> Undo latest pick
        </Button>
      )}
      {!hasPicks &&
        (game.state === "DRAFTING" || game.state === "CAPTAINS_SET") && (
          <div className="flex flex-wrap gap-2">
            {game.state === "DRAFTING" && (
              <Button variant="outline" onClick={onReroll}>
                <RotateCcwIcon /> Reroll captains
              </Button>
            )}
            <RosterCorrections snapshot={snapshot} />
          </div>
        )}
      {teamsComplete &&
        game.state !== "CODE_PENDING" &&
        game.state !== "LOBBY_READY" &&
        game.state !== "PLAYING" && (
          <Button className="w-full" onClick={onLock}>
            <CheckIcon /> Lock teams
          </Button>
        )}
    </>
  );
}

function TeamColumn({
  snapshot,
  team,
}: {
  snapshot: CustomNightSnapshot;
  team: "A" | "B";
}) {
  const participants =
    snapshot.currentGame?.participants.filter(
      (participant) => participant.team === team,
    ) ?? [];
  return (
    <section aria-label={`Team ${team}`} className="space-y-2">
      <h3
        className={
          team === "A"
            ? "font-semibold text-[var(--team-a)]"
            : "font-semibold text-[var(--team-b)]"
        }
      >
        Team {team} · {team === "A" ? "Blue" : "Red"}
      </h3>
      {participants.map((participant) => (
        <DraftPlayerCard
          key={participant.discordId}
          participant={participant}
          canPick={false}
          onPick={() => {
            return;
          }}
        />
      ))}
    </section>
  );
}
