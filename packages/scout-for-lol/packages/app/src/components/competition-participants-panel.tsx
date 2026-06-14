import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  type CompetitionId,
  type CompetitionStatus,
  type CompetitionVisibility,
  participantStatusToString,
  ParticipantStatusSchema,
  PlayerIdSchema,
} from "@scout-for-lol/data";
import { useTRPC } from "#src/lib/trpc.ts";
import { formatDate } from "#src/lib/format.ts";
import { Button } from "#src/components/ui/button.tsx";
import { Input } from "#src/components/ui/input.tsx";
import { Section } from "#src/components/section.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#src/components/ui/table.tsx";

type Participant = {
  id: number;
  playerId: number;
  alias: string;
  discordId: string | null;
  status: string;
  invitedBy: string | null;
  invitedAt: Date | string | null;
  joinedAt: Date | string | null;
  leftAt: Date | string | null;
};

function statusLabel(status: string): string {
  const result = ParticipantStatusSchema.safeParse(status);
  return result.success ? participantStatusToString(result.data) : status;
}

export function CompetitionParticipantsPanel(props: {
  guildId: string;
  competitionId: CompetitionId;
  status: CompetitionStatus;
  visibility: CompetitionVisibility;
  participants: Participant[];
  onChanged: () => void;
}) {
  const { guildId, competitionId, status, visibility, participants } = props;
  const trpc = useTRPC();
  const [inviteId, setInviteId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const locked = status === "ENDED" || status === "CANCELLED";

  const inviteMutation = useMutation(
    trpc.competition.invite.mutationOptions({
      onSuccess: () => {
        setInviteId("");
        setError(null);
        props.onChanged();
      },
      onError: (err) => {
        setError(err.message);
      },
    }),
  );
  const addAllMutation = useMutation(
    trpc.competition.addAllMembers.mutationOptions({
      onSuccess: () => {
        setError(null);
        props.onChanged();
      },
      onError: (err) => {
        setError(err.message);
      },
    }),
  );
  const removeMutation = useMutation(
    trpc.competition.removeParticipant.mutationOptions({
      onSuccess: () => {
        setError(null);
        props.onChanged();
      },
      onError: (err) => {
        setError(err.message);
      },
    }),
  );

  return (
    <Section title="Participants">
      <div className="space-y-3 p-3">
        {!locked && (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={inviteId}
              onChange={(event) => {
                setInviteId(event.target.value);
              }}
              placeholder="Discord user ID to invite"
              className="max-w-xs"
              disabled={visibility === "SERVER_WIDE"}
            />
            <Button
              type="button"
              size="sm"
              disabled={
                inviteMutation.isPending ||
                inviteId.trim().length === 0 ||
                visibility === "SERVER_WIDE"
              }
              onClick={() => {
                inviteMutation.mutate({
                  guildId,
                  competitionId,
                  discordUserId: inviteId.trim(),
                });
              }}
            >
              Invite
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={addAllMutation.isPending}
              onClick={() => {
                if (
                  !globalThis.confirm(
                    "Add every server member with a linked account to this competition?",
                  )
                ) {
                  return;
                }
                addAllMutation.mutate({ guildId, competitionId });
              }}
            >
              Add all members
            </Button>
            {visibility === "SERVER_WIDE" && (
              <span className="text-xs text-muted-foreground">
                Server-wide competitions include everyone automatically.
              </span>
            )}
          </div>
        )}

        {error !== null && <p className="text-sm text-destructive">{error}</p>}

        {participants.length === 0 ? (
          <p className="text-sm text-muted-foreground">No participants yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Player</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="w-1" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {participants.map((participant) => (
                <TableRow key={participant.id}>
                  <TableCell className="font-medium">
                    {participant.alias}
                  </TableCell>
                  <TableCell>{statusLabel(participant.status)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(participant.joinedAt)}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={locked || removeMutation.isPending}
                        onClick={() => {
                          if (
                            !globalThis.confirm(
                              `Remove ${participant.alias} from this competition?`,
                            )
                          ) {
                            return;
                          }
                          removeMutation.mutate({
                            guildId,
                            competitionId,
                            playerId: PlayerIdSchema.parse(
                              participant.playerId,
                            ),
                          });
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </Section>
  );
}
