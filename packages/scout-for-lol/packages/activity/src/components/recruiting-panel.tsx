import { useMutation } from "@tanstack/react-query";
import { Button } from "@scout-for-lol/design-system/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@scout-for-lol/design-system/components/card";
import { ScrollArea } from "@scout-for-lol/design-system/components/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@scout-for-lol/design-system/components/select";
import { toast } from "@scout-for-lol/design-system/components/toaster";
import { useMemo, useState } from "react";
import { DicesIcon } from "lucide-react";
import {
  CustomMapSchema,
  CustomPickModeSchema,
  CustomRosterModeSchema,
  type CustomMap,
  type CustomNightSnapshot,
  type CustomPickMode,
  type CustomRosterMode,
} from "@scout-for-lol/data";
import { NightPlayerCard } from "@/components/player-card";
import { useTRPC } from "@/lib/activity-api";
import {
  mutationErrorText,
  useApplyCustomSnapshot,
} from "@/hooks/use-custom-snapshot";

const rosterLabels: Record<CustomRosterMode, string> = {
  FIRST_TEN: "First ten ready",
  HOST_SELECTED: "Host-selected ten",
  RANDOM_TEN: "Random ten",
};

export function RecruitingPanel({
  snapshot,
}: {
  snapshot: CustomNightSnapshot;
}) {
  const trpc = useTRPC();
  const applySnapshot = useApplyCustomSnapshot();
  const prepare = useMutation(trpc.customs.prepareGame.mutationOptions());
  const [rosterMode, setRosterMode] = useState<CustomRosterMode>("FIRST_TEN");
  const [map, setMap] = useState<CustomMap>("SUMMONERS_RIFT");
  const [pickMode, setPickMode] = useState<CustomPickMode>("TOURNAMENT_DRAFT");
  const [selected, setSelected] = useState<readonly string[]>([]);
  const eligible = useMemo(
    () =>
      snapshot.participants.filter(
        (participant) =>
          participant.held ||
          (participant.availability === "READY" &&
            participant.awayUntil === null &&
            !participant.awayOverdue),
      ),
    [snapshot.participants],
  );
  const toggleSelected = (discordId: string) => {
    setSelected((current) =>
      current.includes(discordId)
        ? current.filter((candidate) => candidate !== discordId)
        : current.length < 10
          ? [...current, discordId]
          : current,
    );
  };
  const submit = async () => {
    try {
      applySnapshot(
        await prepare.mutateAsync({
          nightId: snapshot.id,
          expectedRevision: snapshot.revision,
          rosterMode,
          selectedDiscordIds:
            rosterMode === "HOST_SELECTED" ? [...selected] : [],
          map,
          pickMode,
        }),
      );
    } catch (error) {
      toast.error(mutationErrorText(error));
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Prepare game {(snapshot.currentGame?.sequence ?? 0) + 1}
        </CardTitle>
        <CardDescription>
          {eligible.length.toString()} eligible ·{" "}
          {Math.max(0, 10 - eligible.length).toString()} more needed
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="grid gap-1 text-sm font-medium">
            <span id="roster-mode-label">Roster</span>
            <Select
              value={rosterMode}
              onValueChange={(value) => {
                const parsed = CustomRosterModeSchema.safeParse(value);
                if (parsed.success) setRosterMode(parsed.data);
              }}
            >
              <SelectTrigger
                className="w-full"
                aria-labelledby="roster-mode-label"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CustomRosterModeSchema.options.map((value) => (
                  <SelectItem key={value} value={value}>
                    {rosterLabels[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1 text-sm font-medium">
            <span id="customs-map-label">Map</span>
            <Select
              value={map}
              onValueChange={(value) => {
                const parsed = CustomMapSchema.safeParse(value);
                if (parsed.success) setMap(parsed.data);
              }}
            >
              <SelectTrigger
                className="w-full"
                aria-labelledby="customs-map-label"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="SUMMONERS_RIFT">Summoner’s Rift</SelectItem>
                <SelectItem value="HOWLING_ABYSS">Howling Abyss</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1 text-sm font-medium">
            <span id="pick-mode-label">Pick mode</span>
            <Select
              value={pickMode}
              onValueChange={(value) => {
                const parsed = CustomPickModeSchema.safeParse(value);
                if (parsed.success) setPickMode(parsed.data);
              }}
            >
              <SelectTrigger
                className="w-full"
                aria-labelledby="pick-mode-label"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CustomPickModeSchema.options.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value.replaceAll("_", " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {rosterMode === "HOST_SELECTED" && (
          <ScrollArea className="h-72 rounded-lg border p-2">
            <div className="grid gap-2 sm:grid-cols-2">
              {eligible.map((participant) => (
                <NightPlayerCard
                  key={participant.discordId}
                  participant={participant}
                  selected={selected.includes(participant.discordId)}
                  onSelect={() => {
                    toggleSelected(participant.discordId);
                  }}
                />
              ))}
            </div>
          </ScrollArea>
        )}
        <Button
          className="w-full"
          disabled={
            prepare.isPending ||
            eligible.length < 10 ||
            (rosterMode === "HOST_SELECTED" && selected.length !== 10)
          }
          onClick={() => {
            void submit();
          }}
        >
          {rosterMode === "RANDOM_TEN" && <DicesIcon />}
          {prepare.isPending ? "Preparing…" : "Lock roster settings"}
        </Button>
      </CardContent>
    </Card>
  );
}
