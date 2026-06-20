import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  CompetitionIdSchema,
  type CompetitionCriteria,
  type CompetitionVisibility,
} from "@scout-for-lol/data";
import { useTRPC } from "#src/lib/trpc.ts";
import { Button } from "#src/components/ui/button.tsx";
import type { CriteriaState } from "#src/components/competition-criteria-fields.tsx";
import {
  CompetitionFormFields,
  EMPTY_STATE,
  type FormState,
} from "#src/components/competition-form-fields.tsx";
import { validateForm } from "#src/lib/competition-form-state.ts";

export function CompetitionForm() {
  const { guildId, competitionId: idParam } = useParams();
  const trpc = useTRPC();
  const navigate = useNavigate();
  const safeGuildId = guildId ?? "";

  const idResult =
    idParam === undefined
      ? null
      : CompetitionIdSchema.safeParse(Number(idParam));
  const isEdit = idResult !== null;
  const competitionId =
    idResult?.success === true ? idResult.data : CompetitionIdSchema.parse(1);

  const [state, setState] = useState<FormState>(EMPTY_STATE);
  const [prefilled, setPrefilled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const channelsQuery = useQuery(
    trpc.guild.listChannels.queryOptions(
      { guildId: safeGuildId },
      { enabled: guildId !== undefined },
    ),
  );
  const existingQuery = useQuery(
    trpc.competition.get.queryOptions(
      { guildId: safeGuildId, competitionId },
      { enabled: guildId !== undefined && idResult?.success === true },
    ),
  );

  const existing = existingQuery.data;
  const isDraft = !isEdit || existing?.status === "DRAFT";

  useEffect(() => {
    if (existing === undefined || prefilled) return;
    setState(existingToFormState(existing));
    setPrefilled(true);
  }, [existing, prefilled]);

  const createMutation = useMutation(
    trpc.competition.create.mutationOptions({
      onSuccess: (created) => {
        void navigate(
          `/g/${safeGuildId}/competitions/${created.id.toString()}`,
        );
      },
      onError: (err) => {
        setError(err.message);
      },
    }),
  );
  const editMutation = useMutation(
    trpc.competition.edit.mutationOptions({
      onSuccess: () => {
        void navigate(
          `/g/${safeGuildId}/competitions/${competitionId.toString()}`,
        );
      },
      onError: (err) => {
        setError(err.message);
      },
    }),
  );

  if (guildId === undefined || (isEdit && !idResult.success)) {
    return (
      <p className="text-sm text-destructive">Invalid competition route.</p>
    );
  }

  function handleSubmit(event: React.SyntheticEvent) {
    event.preventDefault();
    setError(null);
    const validated = validateForm(state);
    if (!validated.ok) {
      setError(validated.message);
      return;
    }
    const { maxParticipants, criteria, dates } = validated;
    if (isEdit) {
      editMutation.mutate({
        guildId: safeGuildId,
        competitionId,
        title: state.title,
        description: state.description,
        channelId: state.channelId,
        visibility: state.visibility,
        maxParticipants,
        ...(isDraft ? { dates, criteria } : {}),
      });
      return;
    }
    createMutation.mutate({
      guildId: safeGuildId,
      channelId: state.channelId,
      title: state.title,
      description: state.description,
      visibility: state.visibility,
      maxParticipants,
      dates,
      criteria,
    });
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold tracking-tight">
          {isEdit ? "Edit competition" : "New competition"}
        </h2>
        <Button asChild variant="outline" size="sm">
          <Link to={`/g/${guildId}/competitions`}>Back</Link>
        </Button>
      </div>

      <CompetitionFormFields
        guildId={guildId}
        isEdit={isEdit}
        locked={isEdit && !isDraft}
        pending={createMutation.isPending || editMutation.isPending}
        error={error}
        state={state}
        setState={setState}
        channels={channelsQuery.data}
        onSubmit={handleSubmit}
      />
    </div>
  );
}

function existingToFormState(existing: {
  title: string;
  description: string;
  channelId: string;
  visibility: CompetitionVisibility;
  maxParticipants: number;
  seasonId: string | null;
  startDate: Date | string | null;
  endDate: Date | string | null;
  criteria: CompetitionCriteria;
}): FormState {
  return {
    title: existing.title,
    description: existing.description,
    channelId: existing.channelId,
    visibility: existing.visibility,
    maxParticipants: existing.maxParticipants.toString(),
    dates:
      existing.seasonId === null
        ? {
            mode: "FIXED_DATES",
            startDate:
              existing.startDate === null
                ? ""
                : new Date(existing.startDate).toISOString().slice(0, 10),
            endDate:
              existing.endDate === null
                ? ""
                : new Date(existing.endDate).toISOString().slice(0, 10),
            seasonId: "",
          }
        : {
            mode: "SEASON",
            startDate: "",
            endDate: "",
            seasonId: existing.seasonId,
          },
    criteria: criteriaToState(existing.criteria),
  };
}

function criteriaToState(criteria: CompetitionCriteria): CriteriaState {
  return {
    criteriaType: criteria.type,
    queue:
      criteria.type === "MOST_WINS_CHAMPION"
        ? (criteria.queue ?? "__ANY__")
        : criteria.queue,
    championId:
      criteria.type === "MOST_WINS_CHAMPION"
        ? criteria.championId.toString()
        : "",
    minGames:
      criteria.type === "HIGHEST_WIN_RATE"
        ? criteria.minGames.toString()
        : "10",
  };
}
