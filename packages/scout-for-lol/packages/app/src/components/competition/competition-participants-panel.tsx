import { useRef, useState } from "react";
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
import { analyticsMeta } from "#src/lib/analytics.ts";
import { formatDate } from "#src/lib/format.ts";
import { useDiscordNames } from "#src/hooks/use-discord-names.ts";
import { usePermissions } from "#src/hooks/use-permissions.ts";
import { Button } from "@scout-for-lol/design-system/components/button";
import { DiscordUser } from "#src/components/discord-user.tsx";
import { DiscordMemberCombobox } from "#src/components/discord-member-combobox.tsx";
import { Section } from "#src/components/section.tsx";
import {
  Field,
  FieldError,
  Label,
} from "@scout-for-lol/design-system/components/input";
import {
  fieldErrorMessage,
  focusFirstInvalid,
  FormPendingStatus,
  handleFormSubmit,
  submitThenChangeValidation,
  useScoutForm,
} from "#src/components/semantic-form.tsx";
import { DiscordUserFormSchema } from "#src/lib/form-schemas.ts";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@scout-for-lol/design-system/components/table";

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
  const { perms } = usePermissions(guildId);
  const inviteFormElement = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const names = useDiscordNames(participants.map((p) => p.discordId));

  const locked = status === "ENDED" || status === "CANCELLED";

  const inviteMutation = useMutation(
    trpc.competition.invite.mutationOptions({
      meta: analyticsMeta("competition_participant_invited"),
      onSuccess: () => {
        inviteForm.reset();
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
      meta: analyticsMeta("competition_members_added_all"),
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
      meta: analyticsMeta("competition_participant_removed"),
      onSuccess: () => {
        setError(null);
        props.onChanged();
      },
      onError: (err) => {
        setError(err.message);
      },
    }),
  );

  const inviteForm = useScoutForm({
    defaultValues: { discordUserId: "" },
    validationLogic: submitThenChangeValidation,
    validators: { onDynamic: DiscordUserFormSchema },
    onSubmit: ({ value }) => {
      inviteMutation.mutate({
        guildId,
        competitionId,
        discordUserId: DiscordUserFormSchema.parse(value).discordUserId,
      });
    },
    onSubmitInvalid: () => {
      focusFirstInvalid(inviteFormElement.current);
    },
  });

  return (
    <Section title="Participants">
      <div className="space-y-3 p-3">
        {!locked && perms.can("competitions", "invite") && (
          <div className="flex flex-wrap items-end gap-2">
            <inviteForm.AppForm>
              <form
                ref={inviteFormElement}
                className="flex w-full max-w-md items-end gap-2"
                aria-busy={inviteMutation.isPending}
                onSubmit={(event) => {
                  handleFormSubmit(event, () => inviteForm.handleSubmit());
                }}
              >
                <inviteForm.AppField name="discordUserId">
                  {(field) => {
                    const fieldError = field.state.meta.isTouched
                      ? fieldErrorMessage(field.state.meta.errors)
                      : undefined;
                    return (
                      <Field className="flex-1">
                        <Label htmlFor="competition-invite-member">
                          Member
                        </Label>
                        <DiscordMemberCombobox
                          id="competition-invite-member"
                          name={field.name}
                          guildId={guildId}
                          value={field.state.value}
                          onChange={field.handleChange}
                          disabled={
                            inviteMutation.isPending ||
                            visibility === "SERVER_WIDE"
                          }
                          placeholder="Search members to invite"
                          required
                          {...(fieldError === undefined
                            ? {}
                            : {
                                ariaInvalid: true,
                                ariaDescribedBy: "competition-invite-error",
                              })}
                        />
                        {fieldError === undefined ? null : (
                          <FieldError id="competition-invite-error">
                            {fieldError}
                          </FieldError>
                        )}
                      </Field>
                    );
                  }}
                </inviteForm.AppField>
                <Button
                  type="submit"
                  size="sm"
                  disabled={
                    inviteMutation.isPending || visibility === "SERVER_WIDE"
                  }
                >
                  {inviteMutation.isPending ? "Inviting…" : "Invite"}
                </Button>
                <FormPendingStatus pending={inviteMutation.isPending}>
                  Sending competition invitation…
                </FormPendingStatus>
              </form>
            </inviteForm.AppForm>
            <form
              onSubmit={(event) => {
                event.preventDefault();
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
              <Button
                type="submit"
                size="sm"
                variant="outline"
                disabled={addAllMutation.isPending}
              >
                {addAllMutation.isPending ? "Adding…" : "Add all members"}
              </Button>
            </form>
            {visibility === "SERVER_WIDE" && (
              <span className="text-xs text-scout-subtle">
                Server-wide competitions include everyone automatically.
              </span>
            )}
          </div>
        )}

        {error !== null && <p className="text-sm text-scout-danger">{error}</p>}

        {participants.length === 0 ? (
          <p className="text-sm text-scout-subtle">No participants yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Player</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="w-1">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {participants.map((participant) => (
                <TableRow key={participant.id}>
                  <TableCell className="font-medium">
                    {participant.alias}
                    {participant.discordId !== null && (
                      <span className="ml-2 font-normal">
                        <DiscordUser
                          id={participant.discordId}
                          name={names.resolve(participant.discordId)}
                          className="text-xs text-scout-subtle"
                        />
                      </span>
                    )}
                  </TableCell>
                  <TableCell>{statusLabel(participant.status)}</TableCell>
                  <TableCell className="text-scout-subtle">
                    {formatDate(participant.joinedAt)}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end">
                      {perms.can("competitions", "invite") && (
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
                      )}
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
