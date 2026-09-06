import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { z } from "zod";
import { Badge } from "@scout-for-lol/design-system/components/badge";
import { Button } from "@scout-for-lol/design-system/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@scout-for-lol/design-system/components/card";
import {
  FormPendingStatus,
  focusFirstInvalid,
  handleFormSubmit,
  submitThenChangeValidation,
  useScoutForm,
} from "#src/components/semantic-form.tsx";
import { usePermissions } from "#src/hooks/use-permissions.ts";
import { useDuelSeriesParams } from "#src/lib/route-params.ts";
import { useTRPC } from "#src/lib/trpc.ts";

type Competitor = {
  id: string;
  teamName: string | null;
  accounts: readonly { playerAlias: string }[];
};

type Participant = {
  playerId: number;
  accepted: boolean;
  ready: boolean;
};

function competitorName(competitor: Competitor) {
  return (
    competitor.teamName ??
    competitor.accounts.map((account) => account.playerAlias).join(" + ")
  );
}

function ParticipantActions(props: {
  participants: readonly Participant[];
  state: string;
  onDisclosure: (playerId: number) => void;
  onAccept: () => void;
  onReady: () => void;
  onRevealCode: () => void;
}) {
  if (props.participants.length === 0) return null;
  const needsAcceptance = props.participants.some(
    (participant) => !participant.accepted,
  );
  const needsReadiness = props.participants.some(
    (participant) => !participant.ready,
  );
  const codeAvailable =
    props.state === "code_ready" || props.state === "in_progress";
  return (
    <Card>
      <CardHeader>
        <CardTitle>Your actions</CardTitle>
        <CardDescription>
          Consent, challenge acceptance, and readiness are recorded separately
          for every assigned player.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {props.participants.map((participant) => (
          <Button
            key={participant.playerId}
            type="button"
            variant="outline"
            onClick={() => {
              props.onDisclosure(participant.playerId);
            }}
          >
            Accept disclosure · player {participant.playerId.toString()}
          </Button>
        ))}
        {needsAcceptance ? (
          <Button type="button" onClick={props.onAccept}>
            Accept challenge
          </Button>
        ) : null}
        {!needsAcceptance && needsReadiness ? (
          <Button type="button" onClick={props.onReady}>
            Mark ready
          </Button>
        ) : null}
        {codeAvailable ? (
          <Button type="button" onClick={props.onRevealCode}>
            Reveal tournament code
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function RulesCard(props: {
  ruleset: {
    killTarget: number | null;
    laneCsTarget: number | null;
    firstTurret: boolean;
  };
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Rules</CardTitle>
      </CardHeader>
      <CardContent className="text-sm">
        <ul className="space-y-1">
          <li>Kill target: {props.ruleset.killTarget?.toString() ?? "off"}</li>
          <li>
            Lane CS target: {props.ruleset.laneCsTarget?.toString() ?? "off"}
          </li>
          <li>First turret: {props.ruleset.firstTurret ? "on" : "off"}</li>
        </ul>
        <p className="mt-3 text-scout-subtle">
          The earliest configured objective wins. Jungle CS is excluded.
        </p>
      </CardContent>
    </Card>
  );
}

function GamesCard(props: {
  games: readonly {
    id: string;
    gameNumber: number;
    state: string;
    objective: string | null;
    reviewReason: string | null;
  }[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Games</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="space-y-2">
          {props.games.map((game) => (
            <li className="rounded-md border p-3 text-sm" key={game.id}>
              <strong>Game {game.gameNumber.toString()}</strong> ·{" "}
              {game.state.replaceAll("_", " ")}
              {game.objective === null
                ? ""
                : ` · ${game.objective.replaceAll("_", " ")}`}
              {game.reviewReason === null ? null : (
                <span className="mt-1 block text-scout-danger">
                  {game.reviewReason}
                </span>
              )}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

const ReviewFormSchema = z.strictObject({
  decision: z.string().min(1),
  reason: z.string().trim().min(3).max(1000),
});

function OrganizerReview(props: {
  first: Competitor;
  second: Competitor;
  allowNoContest: boolean;
  pending: boolean;
  onSubmit: (value: z.output<typeof ReviewFormSchema>) => void;
}) {
  const formElement = useRef<HTMLFormElement>(null);
  const form = useScoutForm({
    defaultValues: { decision: "replay", reason: "" },
    validationLogic: submitThenChangeValidation,
    validators: { onDynamic: ReviewFormSchema },
    onSubmit: ({ value }) => {
      props.onSubmit(ReviewFormSchema.parse(value));
    },
    onSubmitInvalid: () => {
      focusFirstInvalid(formElement.current);
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Organizer review</CardTitle>
        <CardDescription>
          No result is awarded automatically. Record an audited reason for
          replay, no-contest, or advancement.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          ref={formElement}
          className="space-y-3"
          onSubmit={(event) => {
            handleFormSubmit(event, () => form.handleSubmit());
          }}
        >
          <fieldset className="space-y-3" disabled={props.pending}>
            <form.AppField name="decision">
              {(field) => (
                <field.NativeSelectField
                  id="review-decision"
                  label="Decision"
                  required
                  options={[
                    { value: "replay", label: "Replay" },
                    ...(props.allowNoContest
                      ? [{ value: "no_contest", label: "No contest" }]
                      : []),
                    {
                      value: props.first.id,
                      label: `Advance ${competitorName(props.first)}`,
                    },
                    {
                      value: props.second.id,
                      label: `Advance ${competitorName(props.second)}`,
                    },
                  ]}
                />
              )}
            </form.AppField>
            <form.AppField name="reason">
              {(field) => (
                <field.TextField
                  id="review-reason"
                  label="Audited reason"
                  required
                  minLength={3}
                  maxLength={1000}
                />
              )}
            </form.AppField>
          </fieldset>
          <FormPendingStatus pending={props.pending}>
            Recording organizer decision…
          </FormPendingStatus>
          <Button type="submit" disabled={props.pending}>
            Record decision
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function DuelSeries() {
  const { guildId, seriesId } = useDuelSeriesParams();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { perms } = usePermissions(guildId);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const series = useQuery(
    trpc.duel.series.queryOptions(
      { guildId, seriesId },
      { refetchInterval: 3000 },
    ),
  );
  const linked = useQuery(trpc.duel.linkedAccounts.queryOptions({ guildId }));
  const invalidate = () => {
    void queryClient.invalidateQueries({
      queryKey: trpc.duel.series.queryKey({ guildId, seriesId }),
    });
  };
  const mutationOptions = {
    onSuccess: invalidate,
    onError: (mutationError: { message: string }) => {
      setError(mutationError.message);
    },
  };
  const disclosure = useMutation(
    trpc.duel.acceptDisclosure.mutationOptions(mutationOptions),
  );
  const accept = useMutation(
    trpc.duel.acceptChallenge.mutationOptions(mutationOptions),
  );
  const ready = useMutation(trpc.duel.ready.mutationOptions(mutationOptions));
  const review = useMutation(
    trpc.duel.reviewResult.mutationOptions(mutationOptions),
  );

  if (series.isPending || linked.isPending) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 text-sm text-scout-subtle">
        Loading series…
      </div>
    );
  }
  if (series.isError || linked.isError) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 text-sm text-scout-danger">
        {series.error?.message ?? linked.error?.message}
      </div>
    );
  }
  const ownPlayerIds = new Set<number>(
    linked.data.map((account) => account.playerId),
  );
  const ownParticipants = series.data.participants.filter((participant) =>
    ownPlayerIds.has(participant.playerId),
  );
  const revealCode = async () => {
    try {
      const result = await queryClient.query(
        trpc.duel.code.queryOptions({ guildId, seriesId }),
      );
      setCode(result.code);
    } catch (codeError) {
      setError(
        codeError instanceof Error ? codeError.message : String(codeError),
      );
    }
  };
  const reviewRequired =
    series.data.state === "needs_review" || series.data.state === "overdue";
  const canReview =
    series.data.isOrganizer || perms.can("competitions", "update");
  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:py-12">
      <Link
        className="text-sm text-scout-subtle hover:underline"
        to={
          series.data.eventId === null
            ? `/duels/${guildId}`
            : `/duels/${guildId}/events/${series.data.eventId}`
        }
      >
        ← Back
      </Link>
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">
            {competitorName(series.data.competitorOne)} vs{" "}
            {competitorName(series.data.competitorTwo)}
          </h1>
          <Badge variant="outline">
            {series.data.state.replaceAll("_", " ")}
          </Badge>
        </div>
        <p className="text-scout-subtle">
          Best of {series.data.bestOf.toString()} · deadline{" "}
          {series.data.deadlineAt === null
            ? "not set"
            : new Date(series.data.deadlineAt).toLocaleString()}
        </p>
      </header>
      {error === null ? null : (
        <p role="alert" className="text-sm text-scout-danger">
          {error}
        </p>
      )}
      <ParticipantActions
        participants={ownParticipants}
        state={series.data.state}
        onDisclosure={(playerId) => {
          setError(null);
          disclosure.mutate({ guildId, playerId });
        }}
        onAccept={() => {
          setError(null);
          accept.mutate({ guildId, seriesId });
        }}
        onReady={() => {
          setError(null);
          ready.mutate({ guildId, seriesId });
        }}
        onRevealCode={() => {
          void revealCode();
        }}
      />
      {code === null ? null : (
        <Card>
          <CardHeader>
            <CardTitle>Tournament code</CardTitle>
            <CardDescription>
              Visible only in this authenticated participant view. Do not post
              it publicly.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <code className="break-all text-lg">{code}</code>
          </CardContent>
        </Card>
      )}
      <RulesCard ruleset={series.data.ruleset} />
      <GamesCard games={series.data.games} />
      {reviewRequired && canReview ? (
        <OrganizerReview
          first={series.data.competitorOne}
          second={series.data.competitorTwo}
          allowNoContest={series.data.eventId === null}
          pending={review.isPending}
          onSubmit={(value) => {
            const decision =
              value.decision === "replay"
                ? { kind: "replay" as const }
                : value.decision === "no_contest"
                  ? { kind: "no_contest" as const }
                  : {
                      kind: "advance" as const,
                      winnerCompetitorId: value.decision,
                    };
            review.mutate({
              guildId,
              seriesId,
              reason: value.reason,
              idempotencyKey: crypto.randomUUID(),
              decision,
            });
          }}
        />
      ) : null}
    </div>
  );
}
