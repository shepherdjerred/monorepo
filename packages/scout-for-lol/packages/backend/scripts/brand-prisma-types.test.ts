import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  brandPrismaTypes,
  brandPrismaTypesText,
} from "./brand-prisma-types.ts";

const PRISMA_DECLARATION_FIXTURE = `/**
 * Client
 **/
export type Player = $Result.DefaultSelection<Prisma.$PlayerPayload>
type PlayerGetPayload<S extends boolean | null | undefined | PlayerDefaultArgs> = $Result.GetResult<Prisma.$PlayerPayload, S>
type PlayerPayloadToResult = $Utils.PayloadToResult<Prisma.$PlayerPayload>

export namespace Prisma {
  export type $PlayerPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "Player"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      id: number
      alias: string
      discordId: string | null
      serverId: string
      puuid: string
      region: string
      lastProcessedMatchId: string | null
      createdTime: Date
    }, ExtArgs["result"]["player"]>
    composites: {}
  }

  export type $ReportPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "Report"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      id: number
      outputFormat: string
      lastRunStatus: string | null
      sourceCompetitionId: number | null
      title: string
    }, ExtArgs["result"]["report"]>
    composites: {}
  }

  export type PlayerWhereInput = {
    id?: IntFilter<"Player"> | number
    alias?: StringFilter<"Player"> | string
    discordId?: StringNullableFilter<"Player"> | string | null
    serverId?: StringFilter<"Player"> | string
    puuid?: StringFilter<"Player"> | string
    region?: StringFilter<"Player"> | string
    lastProcessedMatchId?: StringNullableFilter<"Player"> | string | null
    createdTime?: DateTimeFilter<"Player"> | Date | string
  }

  export type PlayerUncheckedCreateInput = {
    id?: number
    alias: string
    discordId?: string | null
    serverId: string
    puuid: string
    region: string
    lastProcessedMatchId?: string | null
    createdTime: Date | string
  }

  export type PlayerUpdateInput = {
    id?: IntFieldUpdateOperationsInput | number
    alias?: StringFieldUpdateOperationsInput | string
    discordId?: NullableStringFieldUpdateOperationsInput | string | null
    serverId?: StringFieldUpdateOperationsInput | string
    puuid?: StringFieldUpdateOperationsInput | string
    region?: StringFieldUpdateOperationsInput | string
    lastProcessedMatchId?: NullableStringFieldUpdateOperationsInput | string | null
    createdTime?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PlayerMinAggregateOutputType = {
    id: number | null
    alias: string | null
    discordId: string | null
    serverId: string | null
    puuid: string | null
    region: string | null
    lastProcessedMatchId: string | null
    createdTime: Date | null
  }

  export type PlayerGroupByOutputType = {
    id: number
    alias: string
    discordId: string | null
    serverId: string
    puuid: string
    region: string
    lastProcessedMatchId: string | null
    createdTime: Date
  }

  interface PlayerFieldRefs {
    readonly id: FieldRef<"Player", 'Int'>
    readonly alias: FieldRef<"Player", 'String'>
    readonly discordId: FieldRef<"Player", 'String'>
    readonly serverId: FieldRef<"Player", 'String'>
    readonly puuid: FieldRef<"Player", 'String'>
    readonly region: FieldRef<"Player", 'String'>
    readonly lastProcessedMatchId: FieldRef<"Player", 'String'>
    readonly createdTime: FieldRef<"Player", 'DateTime'>
  }
}
`;

const EXPECTED_TRANSFORM_COUNT = 46;
const SPEED_FIXTURE_REPEAT_COUNT = 400;
const SPEED_LIMIT_MS = 750;

const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "brand-prisma-types-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  const removals = temporaryDirectories
    .splice(0)
    .map((directory) => rm(directory, { recursive: true, force: true }));
  await Promise.all(removals);
});

describe("brand-prisma-types", () => {
  test("brands payloads, inputs, aggregate outputs, field refs, and payload references", () => {
    const result = brandPrismaTypesText(PRISMA_DECLARATION_FIXTURE);

    expect(result.count).toBe(EXPECTED_TRANSFORM_COUNT);
    expect(result.text).toContain(
      'import { CompetitionId, DiscordAccountId, DiscordGuildId, LeaguePuuid, MatchId, PlayerId, Region, ReportId, ReportOutputFormat, ReportRunStatus } from "@scout-for-lol/data";',
    );
    expect(result.text).toContain(
      "export type Player = $Result.DefaultSelection<Prisma.$PlayerPayload<$Extensions.DefaultArgs>>",
    );
    expect(result.text).toContain(
      "type PlayerGetPayload<S extends boolean | null | undefined | PlayerDefaultArgs> = $Result.GetResult<Prisma.$PlayerPayload<ExtArgs>, S>",
    );
    expect(result.text).toContain(
      "type PlayerPayloadToResult = $Utils.PayloadToResult<Prisma.$PlayerPayload<ExtArgs>>",
    );
    expect(result.text).toContain("id: PlayerId");
    expect(result.text).toContain("discordId: DiscordAccountId | null");
    expect(result.text).toContain("serverId: DiscordGuildId");
    expect(result.text).toContain("puuid: LeaguePuuid");
    expect(result.text).toContain("region: Region");
    expect(result.text).toContain("lastProcessedMatchId: MatchId | null");
    expect(result.text).toContain('id?: IntFilter<"Player"> | PlayerId');
    expect(result.text).toContain(
      'discordId?: StringNullableFilter<"Player"> | DiscordAccountId | null',
    );
    expect(result.text).toContain(
      'createdTime?: DateTimeFilter<"Player"> | Date | string',
    );
    expect(result.text).toContain('readonly id: FieldRef<"Player", PlayerId>');
    expect(result.text).toContain(
      'readonly serverId: FieldRef<"Player", DiscordGuildId>',
    );
    expect(result.text).toContain("outputFormat: ReportOutputFormat");
    expect(result.text).toContain("lastRunStatus: ReportRunStatus | null");
    expect(result.text).toContain("sourceCompetitionId: CompetitionId | null");
    expect(result.text).not.toContain("id: number");
    expect(result.text).not.toContain("discordId: string | null");
  });

  test("writes branded output to the configured output directory", async () => {
    const inputDirectory = await createTemporaryDirectory();
    const outputDirectory = await createTemporaryDirectory();

    await Bun.write(`${inputDirectory}/index.d.ts`, PRISMA_DECLARATION_FIXTURE);

    const result = await brandPrismaTypes({
      inputDir: inputDirectory,
      outputDir: outputDirectory,
    });
    const outputText = await Bun.file(`${outputDirectory}/index.d.ts`).text();

    expect(result.count).toBe(EXPECTED_TRANSFORM_COUNT);
    expect(outputText).toBe(result.text);
    expect(outputText).toContain("id: PlayerId");
    expect(outputText).toContain("sourceCompetitionId: CompetitionId | null");
  });

  test("does not leak imports between text transform calls", () => {
    const playerResult = brandPrismaTypesText(PRISMA_DECLARATION_FIXTURE);
    const reportOnlyFixture = `export namespace Prisma {
  export type $ReportPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "Report"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      id: number
      outputFormat: string
    }, ExtArgs["result"]["report"]>
    composites: {}
  }
}
`;

    const reportResult = brandPrismaTypesText(reportOnlyFixture);

    expect(playerResult.importedTypes).toContain("PlayerId");
    expect(reportResult.importedTypes).toEqual([
      "ReportId",
      "ReportOutputFormat",
    ]);
    expect(reportResult.text).toContain(
      'import { ReportId, ReportOutputFormat } from "@scout-for-lol/data";',
    );
    expect(reportResult.text).not.toContain("PlayerId");
  });

  test("keeps large generated declarations under the speed budget", () => {
    const largeFixture = PRISMA_DECLARATION_FIXTURE.repeat(
      SPEED_FIXTURE_REPEAT_COUNT,
    );

    const startMs = performance.now();
    const result = brandPrismaTypesText(largeFixture);
    const elapsedMs = performance.now() - startMs;

    expect(result.count).toBe(
      EXPECTED_TRANSFORM_COUNT * SPEED_FIXTURE_REPEAT_COUNT,
    );
    expect(elapsedMs).toBeLessThan(SPEED_LIMIT_MS);
  });
});
