import {
  VisualizationSnapshotSchema,
  type CompetitionWithCriteria,
  type VisualizationAnnotation,
  type VisualizationSnapshot,
} from "@scout-for-lol/data";

export function withCompetitionAnnotations(
  snapshot: VisualizationSnapshot | null,
  competition: CompetitionWithCriteria,
): VisualizationSnapshot | null {
  return snapshot === null
    ? null
    : VisualizationSnapshotSchema.parse({
        ...snapshot,
        annotations: competitionAnnotations(competition),
      });
}

export function competitionAnnotations(
  competition: CompetitionWithCriteria,
): VisualizationAnnotation[] {
  return [
    ...(competition.seasonId === null || competition.startDate === null
      ? []
      : [
          {
            id: "season-start",
            kind: "season_boundary" as const,
            timestamp: competition.startDate.toISOString(),
            label: "Season start",
          },
        ]),
    ...(competition.startDate === null
      ? []
      : [
          {
            id: "competition-start",
            kind: "competition_start" as const,
            timestamp: competition.startDate.toISOString(),
            label: "Competition start",
          },
        ]),
    ...(competition.endDate === null
      ? []
      : [
          {
            id: "competition-end",
            kind: "competition_end" as const,
            timestamp: competition.endDate.toISOString(),
            label: "Competition end",
          },
        ]),
    ...(competition.seasonId === null || competition.endDate === null
      ? []
      : [
          {
            id: "season-end",
            kind: "season_boundary" as const,
            timestamp: competition.endDate.toISOString(),
            label: "Season end",
          },
        ]),
  ];
}
