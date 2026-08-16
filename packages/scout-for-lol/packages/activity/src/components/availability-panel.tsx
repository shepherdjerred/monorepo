import { useMutation } from "@tanstack/react-query";
import { Clock3Icon, LogInIcon } from "lucide-react";
import { toast } from "sonner";
import {
  CustomAvailabilitySchema,
  type CustomNightParticipant,
  type CustomNightSnapshot,
} from "@scout-for-lol/data";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useTRPC } from "@/lib/activity-api";
import {
  mutationErrorText,
  useApplyCustomSnapshot,
} from "@/hooks/use-custom-snapshot";

const availabilityLabels = {
  READY: "Ready",
  MAYBE: "Maybe",
  SITTING_OUT: "Sitting out",
  DONE: "Done",
} as const;

function awayLabel(participant: CustomNightParticipant): string | null {
  if (participant.awayUntil === null) return null;
  if (participant.awayOverdue) return "Return overdue";
  return `Away until ${new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(participant.awayUntil))}`;
}

export function AvailabilityPanel({
  snapshot,
  participant,
}: {
  snapshot: CustomNightSnapshot;
  participant: CustomNightParticipant;
}) {
  const trpc = useTRPC();
  const applySnapshot = useApplyCustomSnapshot();
  const availability = useMutation(
    trpc.customs.setAvailability.mutationOptions(),
  );
  const away = useMutation(trpc.customs.setAway.mutationOptions());
  const account = useMutation(trpc.customs.selectAccount.mutationOptions());
  const mutate = async (
    operation: Promise<{ snapshot: CustomNightSnapshot }>,
  ) => {
    try {
      applySnapshot(await operation);
    } catch (error) {
      toast.error(mutationErrorText(error));
    }
  };
  const setAvailability = (values: string[]) => {
    const next = values.at(-1);
    const parsed = CustomAvailabilitySchema.safeParse(next);
    if (!parsed.success || parsed.data === participant.availability) return;
    void mutate(
      availability.mutateAsync({
        nightId: snapshot.id,
        expectedRevision: snapshot.revision,
        availability: parsed.data,
      }),
    );
  };
  const setAway = (minutes: number | null) => {
    void mutate(
      away.mutateAsync({
        nightId: snapshot.id,
        expectedRevision: snapshot.revision,
        awayUntil:
          minutes === null
            ? null
            : new Date(Date.now() + minutes * 60_000).toISOString(),
      }),
    );
  };
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Your availability</CardTitle>
        {awayLabel(participant) !== null && (
          <Badge
            variant={participant.awayOverdue ? "destructive" : "secondary"}
          >
            {awayLabel(participant)}
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <ToggleGroup
          className="grid w-full grid-cols-2 sm:grid-cols-4"
          value={[participant.availability]}
          onValueChange={setAvailability}
          aria-label="Availability"
        >
          {CustomAvailabilitySchema.options.map((value) => (
            <ToggleGroupItem key={value} value={value} variant="outline">
              {availabilityLabels[value]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <div className="flex flex-wrap gap-2">
          {participant.awayUntil === null ? (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  setAway(5);
                }}
              >
                <Clock3Icon /> Back in 5
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setAway(10);
                }}
              >
                <Clock3Icon /> Back in 10
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              onClick={() => {
                setAway(null);
              }}
            >
              <LogInIcon /> I’m back
            </Button>
          )}
        </div>
        {participant.accounts.length > 1 && (
          <div className="grid gap-2 text-sm font-medium">
            <span id="customs-account-label">NA1 account for Customs</span>
            <Select
              value={participant.selectedAccountId}
              onValueChange={(accountId) => {
                if (accountId === null) return;
                void mutate(
                  account.mutateAsync({
                    nightId: snapshot.id,
                    expectedRevision: snapshot.revision,
                    accountId,
                  }),
                );
              }}
            >
              <SelectTrigger
                className="w-full"
                aria-labelledby="customs-account-label"
              >
                <SelectValue placeholder="Select an account" />
              </SelectTrigger>
              <SelectContent>
                {participant.accounts.map((candidate) => (
                  <SelectItem
                    key={candidate.accountId}
                    value={candidate.accountId}
                  >
                    {candidate.riotGameName ?? participant.playerAlias}#
                    {candidate.riotTagLine ?? "NA1"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {participant.playerId === null && (
          <p className="text-sm text-activity-danger">
            Link a Scout player and NA1 account before the roster can lock.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
