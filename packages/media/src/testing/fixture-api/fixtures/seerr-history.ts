import type { z } from "zod";
import type { ImportedRequestHistorySchema } from "#shared/personal-migration/history.ts";
import type { Persona } from "#testing/fixture-api/personas.ts";

export function seerrRequestHistory(
  persona: Persona,
): z.input<typeof ImportedRequestHistorySchema> {
  if (persona === "member") {
    return [
      {
        id: "1".repeat(64),
        sourceKind: "jellyseerr",
        scope: "season",
        seasonNumbers: [2],
        title: "Detectorists",
        requestedAt: "2025-09-15T01:23:00.000Z",
        sourceStatus: 5,
      },
    ];
  }
  return [
    {
      id: "2".repeat(64),
      sourceKind: "seerr",
      scope: "movie",
      seasonNumbers: [],
      title: "A Matter of Life and Death",
      requestedAt: "2025-08-10T23:05:00.000Z",
      sourceStatus: 3,
    },
    {
      id: "3".repeat(64),
      sourceKind: "overseerr",
      scope: "season",
      seasonNumbers: [1, 2],
      title: "Freaks and Geeks",
      requestedAt: null,
      sourceStatus: 4,
    },
  ];
}
