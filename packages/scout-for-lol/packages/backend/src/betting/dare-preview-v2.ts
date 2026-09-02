import { z } from "zod";
import type {
  DareCompiledPlanV2,
  DareTargetBindingV2,
} from "@scout-for-lol/data";
import { compileDarePreviewQueryV2 } from "#src/betting/dare-preview-compiler-v2.ts";
import { resolveLakeDir } from "#src/report-lake/paths.ts";
import {
  withDuckDBConnection,
  type DuckDBSession,
} from "#src/reports/duckdb/instance.ts";
import { resolveLakeFiles, type BoundParam } from "#src/reports/duckdb/lake.ts";

const PreviewRowSchema = z.strictObject({
  achieved: z.boolean().nullable(),
  eligible_games: z.union([z.bigint(), z.number()]).transform(Number),
  coverage_complete: z.boolean(),
  game_set: z.string().nullable(),
  match_id: z.string().nullable(),
  game_end_at: z
    .union([
      z.string(),
      z
        .object({ micros: z.bigint() })
        .transform((value) =>
          new Date(Number(value.micros / 1000n)).toISOString(),
        ),
    ])
    .nullable(),
  matched: z.boolean().nullable(),
});

export type DareHistoricalPreviewV2 = {
  achieved: boolean | null;
  eligibleGames: number;
  coverageComplete: boolean;
  evidence: {
    gameSet: string;
    matchId: string;
    gameEndAt: string;
    matched: boolean | null;
  }[];
};

function bindParams(session: DuckDBSession, params: BoundParam[]) {
  return params.map((param) =>
    param.kind === "list" ? session.list(param.values) : param.value,
  );
}

export async function historicallyPreviewDareV2(input: {
  plan: DareCompiledPlanV2;
  targets: readonly DareTargetBindingV2[];
  start: Date;
  end: Date;
  lakeDir?: string | undefined;
}): Promise<DareHistoricalPreviewV2> {
  const files = await resolveLakeFiles(input.lakeDir ?? resolveLakeDir());
  const compiled = compileDarePreviewQueryV2({
    plan: input.plan,
    targets: input.targets,
    files,
    start: input.start,
    end: input.end,
  });
  const rows = await withDuckDBConnection(async (session) => {
    const result = await session.run(
      compiled.sql,
      bindParams(session, compiled.params),
    );
    return result.map((row) => PreviewRowSchema.parse(row));
  });
  const first = rows[0];
  if (first === undefined) {
    throw new Error("Dare v2 preview query returned no result row.");
  }
  return {
    achieved: first.achieved,
    eligibleGames: first.eligible_games,
    coverageComplete: first.coverage_complete,
    evidence: rows.flatMap((row) =>
      row.game_set === null || row.match_id === null || row.game_end_at === null
        ? []
        : [
            {
              gameSet: row.game_set,
              matchId: row.match_id,
              gameEndAt: row.game_end_at,
              matched: row.matched,
            },
          ],
    ),
  };
}
