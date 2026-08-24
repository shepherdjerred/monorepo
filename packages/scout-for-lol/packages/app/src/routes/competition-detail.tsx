import { Link, useNavigate } from "react-router";
import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import {
  competitionGameVariantToString,
  visibilityToString,
  visibilityDescription,
} from "@scout-for-lol/data";
import { useTRPC } from "#src/lib/trpc.ts";
import { analyticsMeta } from "#src/lib/analytics.ts";
import { channelLabel } from "#src/lib/format.ts";
import { summarizeCriteria } from "#src/lib/criteria-summary.ts";
import { usePermissions } from "#src/hooks/use-permissions.ts";
import { useCompetitionParams } from "#src/lib/route-params.ts";
import { Button } from "@scout-for-lol/design-system/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@scout-for-lol/design-system/components/card";
import { CompetitionStatusBadge } from "#src/components/status-badge.tsx";
import { CompetitionLeaderboardPanel } from "#src/components/competition-leaderboard-panel.tsx";
import { CompetitionParticipantsPanel } from "#src/components/competition-participants-panel.tsx";

export function CompetitionDetail() {
  const { guildId, competitionId } = useCompetitionParams();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { perms } = usePermissions(guildId);

  const competitionQuery = useSuspenseQuery(
    trpc.competition.get.queryOptions({ guildId, competitionId }),
  );
  const channelsQuery = useQuery(
    trpc.guild.listChannels.queryOptions({ guildId }),
  );
  const cancelMutation = useMutation(
    trpc.competition.cancel.mutationOptions({
      meta: analyticsMeta("competition_cancelled"),
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: trpc.competition.get.queryKey({
            guildId,
            competitionId,
          }),
        });
        void queryClient.invalidateQueries({
          queryKey: trpc.competition.list.pathKey(),
        });
      },
    }),
  );

  const competition = competitionQuery.data;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold tracking-tight">
            {competition.title}
          </h2>
          <CompetitionStatusBadge status={competition.status} />
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to={`/g/${guildId}/competitions`}>Back</Link>
          </Button>
          {(competition.status === "DRAFT" ||
            competition.status === "ACTIVE") && (
            <>
              {perms.can("competitions", "update") && (
                <Button asChild variant="outline" size="sm">
                  <Link
                    to={`/g/${guildId}/competitions/${competitionId.toString()}/edit`}
                  >
                    Edit
                  </Link>
                </Button>
              )}
              {perms.can("competitions", "cancel") && (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={cancelMutation.isPending}
                  onClick={() => {
                    if (
                      !globalThis.confirm(
                        `Cancel "${competition.title}"? This cannot be undone.`,
                      )
                    ) {
                      return;
                    }
                    cancelMutation.mutate({ guildId, competitionId });
                  }}
                >
                  Cancel
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {cancelMutation.error && (
        <p className="text-sm text-scout-danger">
          {cancelMutation.error.message}
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-scout-subtle">{competition.description}</p>
            <div>
              <span className="text-scout-subtle">Visibility</span>
              <p>{visibilityToString(competition.visibility)}</p>
              <p className="text-xs text-scout-subtle">
                {visibilityDescription(competition.visibility)}
              </p>
            </div>
            <div>
              <span className="text-scout-subtle">Channel</span>
              <p>{channelLabel(channelsQuery.data, competition.channelId)}</p>
            </div>
            <div>
              <span className="text-scout-subtle">Max participants</span>
              <p>{competition.maxParticipants}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Schedule</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div>
              <span className="text-scout-subtle">Start</span>
              <p>
                {formatCompetitionDate(
                  competition.startDate,
                  competition.analysisTimezone,
                )}
              </p>
            </div>
            <div>
              <span className="text-scout-subtle">End</span>
              <p>
                {formatCompetitionDate(
                  competition.endDate,
                  competition.analysisTimezone,
                )}
              </p>
              <p className="text-xs text-scout-subtle">
                {competition.analysisTimezone}
              </p>
            </div>
            <div>
              <span className="text-scout-subtle">Update schedule</span>
              {competition.scheduledUpdatesEnabled ? (
                <p className="font-mono text-xs">
                  {competition.updateCronExpression} ·{" "}
                  {competition.scheduleTimezone}
                </p>
              ) : (
                <p>Disabled</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Criteria</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="font-medium">
              {competitionGameVariantToString(competition.gameVariant)}
            </p>
            <p>{summarizeCriteria(competition.criteria)}</p>
          </CardContent>
        </Card>
      </div>

      <CompetitionLeaderboardPanel
        guildId={guildId}
        competitionId={competitionId}
        status={competition.status}
        startDate={competition.startDate}
        endDate={competition.endDate}
        analysisTimezone={competition.analysisTimezone}
        criteria={competition.criteria}
      />

      <CompetitionParticipantsPanel
        guildId={guildId}
        competitionId={competitionId}
        status={competition.status}
        visibility={competition.visibility}
        participants={competition.participants}
        onChanged={() => {
          void queryClient.invalidateQueries({
            queryKey: trpc.competition.get.queryKey({
              guildId,
              competitionId,
            }),
          });
        }}
      />

      <p className="text-xs text-scout-subtle">
        Need to change criteria or dates?{" "}
        {competition.status === "DRAFT" ? (
          <button
            type="button"
            className="underline"
            onClick={() => {
              void navigate(
                `/g/${guildId}/competitions/${competitionId.toString()}/edit`,
              );
            }}
          >
            Edit this competition
          </button>
        ) : (
          "Those are locked once a competition starts."
        )}
      </p>
    </div>
  );
}

function formatCompetitionDate(
  value: Date | string | null,
  timezone: string,
): string {
  if (value === null) return "Not set";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(value));
}
