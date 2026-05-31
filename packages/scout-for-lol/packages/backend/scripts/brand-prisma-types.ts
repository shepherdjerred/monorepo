#!/usr/bin/env bun
/**
 * Post-process Prisma generated types to use branded IDs.
 *
 * Prisma does not currently let schema fields declare custom TypeScript output
 * aliases, so this rewrites the generated declaration file after
 * `prisma generate`.
 */

import { mkdir } from "node:fs/promises";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("brand-prisma-types");

const INPUT_DIR =
  process.env["BRAND_TYPES_INPUT_DIR"] ??
  `${import.meta.dir}/../generated/prisma/client`;
const OUTPUT_DIR = process.env["BRAND_TYPES_OUTPUT_DIR"] ?? INPUT_DIR;

type BlockRange = {
  readonly start: number;
  readonly end: number;
};

type TransformResult = {
  readonly text: string;
  readonly count: number;
};

type BrandPrismaTypesOptions = {
  readonly inputDir: string;
  readonly outputDir: string;
};

const BRANDED_TYPES_TO_IMPORT = new Set<string>();

export async function brandPrismaTypes(
  options?: BrandPrismaTypesOptions,
): Promise<TransformResult> {
  BRANDED_TYPES_TO_IMPORT.clear();
  const resolvedOptions = options ?? {
    inputDir: INPUT_DIR,
    outputDir: OUTPUT_DIR,
  };

  logger.info("Branding Prisma types with text transformation...");

  const prismaTypesPath = `${resolvedOptions.inputDir}/index.d.ts`;
  logger.info(`Processing: ${prismaTypesPath}`);

  const inputFile = Bun.file(prismaTypesPath);
  const result = brandPrismaTypesText(await inputFile.text());

  const outputPath = `${resolvedOptions.outputDir}/index.d.ts`;
  await mkdir(resolvedOptions.outputDir, { recursive: true });
  await Bun.write(outputPath, result.text);

  logger.info(`Save completed: ${outputPath}`);
  logger.info(`Transformed ${result.count.toString()} properties`);
  logger.info(`Added imports: ${[...BRANDED_TYPES_TO_IMPORT].join(", ")}`);
  logger.info("Prisma types successfully branded.");

  return result;
}

export function brandPrismaTypesText(inputText: string): TransformResult {
  BRANDED_TYPES_TO_IMPORT.clear();

  let text = inputText;
  let transformCount = 0;

  const payloadResult = transformPayloadTypes(text);
  text = payloadResult.text;
  transformCount += payloadResult.count;

  const simpleTypeResult = transformSimpleTypeAliases(text);
  text = simpleTypeResult.text;
  transformCount += simpleTypeResult.count;

  const fieldRefsResult = transformFieldRefsInterfaces(text);
  text = fieldRefsResult.text;
  transformCount += fieldRefsResult.count;

  text = instantiatePayloadReferences(text);
  text = insertBrandImports(text);

  return { text, count: transformCount };
}

function transformPayloadTypes(text: string): TransformResult {
  return transformNamedBlocks(
    text,
    /export type \$(\w+)Payload<[^>]+>\s*=\s*\{/g,
    (block, modelName) => {
      const scalarsPattern =
        /scalars: \$Extensions\.GetPayloadResult<\{([\s\S]*?)\}, ExtArgs\["result"\]\["[^"]+"\]>/;
      const match = scalarsPattern.exec(block);
      const scalarsContent = match?.[1];
      if (scalarsContent === undefined) {
        return { text: block, count: 0 };
      }

      const transformed = transformFieldLines(scalarsContent, modelName);
      if (transformed.count === 0) {
        return { text: block, count: 0 };
      }

      return {
        text: block.replace(scalarsContent, transformed.text),
        count: transformed.count,
      };
    },
  );
}

function transformSimpleTypeAliases(text: string): TransformResult {
  return transformNamedBlocks(
    text,
    /export type (\w+(?:WhereUniqueInput|WhereInput|Create\w*Input|Update\w*Input|MinAggregateOutputType|MaxAggregateOutputType|GroupByOutputType))\s*=\s*\{/g,
    (block, typeName) => {
      const modelName = getModelNameForTypeAlias(typeName);
      if (modelName === null) {
        return { text: block, count: 0 };
      }

      return transformFieldLines(block, modelName);
    },
  );
}

function transformFieldRefsInterfaces(text: string): TransformResult {
  return transformNamedBlocks(
    text,
    /interface (\w+)FieldRefs\s*\{/g,
    (block, modelName) => transformFieldRefLines(block, modelName),
  );
}

function transformNamedBlocks(
  text: string,
  pattern: RegExp,
  transform: (block: string, name: string) => TransformResult,
): TransformResult {
  const replacements: string[] = [];
  let cursor = 0;
  let totalCount = 0;
  let match = pattern.exec(text);

  while (match !== null) {
    const name = match[1];
    if (name === undefined) {
      match = pattern.exec(text);
      continue;
    }

    const openingBraceIndex = text.indexOf("{", match.index);
    if (openingBraceIndex === -1) {
      break;
    }

    const range = findBalancedBraceRange(text, openingBraceIndex);
    if (range === null) {
      break;
    }

    const blockStart = match.index;
    const blockEnd = range.end + 1;
    const block = text.slice(blockStart, blockEnd);
    const transformed = transform(block, name);

    replacements.push(text.slice(cursor, blockStart), transformed.text);
    cursor = blockEnd;
    totalCount += transformed.count;

    pattern.lastIndex = blockEnd;
    match = pattern.exec(text);
  }

  if (replacements.length === 0) {
    return { text, count: 0 };
  }

  replacements.push(text.slice(cursor));
  return { text: replacements.join(""), count: totalCount };
}

function findBalancedBraceRange(
  text: string,
  openingBraceIndex: number,
): BlockRange | null {
  let depth = 0;

  for (let index = openingBraceIndex; index < text.length; index++) {
    const char = text[index];
    if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) {
        return { start: openingBraceIndex, end: index };
      }
    }
  }

  return null;
}

function transformFieldLines(
  content: string,
  modelName: string,
): TransformResult {
  let count = 0;
  const text = content.replaceAll(
    /^(\s*)([A-Z]\w*)\??:[ \t]*(\S[^\n]*)$/gim,
    (
      line: string,
      indentation: string,
      fieldName: string,
      typeExpression: string,
    ) => {
      const brandedType = getBrandedType(fieldName, modelName);
      if (brandedType === null) {
        return line;
      }

      const transformedType = replacePrimitiveType(typeExpression, brandedType);
      if (transformedType === typeExpression) {
        return line;
      }

      BRANDED_TYPES_TO_IMPORT.add(brandedType);
      count++;
      const optionalMarker = line.includes("?:") ? "?" : "";
      return `${indentation}${fieldName}${optionalMarker}: ${transformedType}`;
    },
  );

  return { text, count };
}

function replacePrimitiveType(
  typeExpression: string,
  brandedType: string,
): string {
  const numberResult = typeExpression.replace(/\bnumber\b/, brandedType);
  if (numberResult !== typeExpression) {
    return numberResult;
  }

  return typeExpression.replace(/\bstring\b/, brandedType);
}

function transformFieldRefLines(
  content: string,
  modelName: string,
): TransformResult {
  let count = 0;
  const text = content.replaceAll(
    /^(\s*readonly\s+)([A-Za-z]\w*): FieldRef<"[^"]+",\s*'(?:Int|String|DateTime|Boolean|Float|Decimal|BigInt|Bytes|Json)'>$/gm,
    (line: string, prefix: string, fieldName: string) => {
      const brandedType = getBrandedType(fieldName, modelName);
      if (brandedType === null) {
        return line;
      }

      BRANDED_TYPES_TO_IMPORT.add(brandedType);
      count++;
      return `${prefix}${fieldName}: FieldRef<"${modelName}", ${brandedType}>`;
    },
  );

  return { text, count };
}

function getModelNameForTypeAlias(typeName: string): string | null {
  const modelName = typeName.replace(
    /UncheckedCreateWithout\w+Input|UncheckedUpdateWithout\w+Input|UncheckedCreateInput|UncheckedUpdateInput|CreateWithout\w+Input|UpdateWithout\w+Input|CreateMany\w+Input|UpdateMany\w+Input|CreateInput|UpdateInput|WhereUniqueInput|WhereInput|MinAggregateOutputType|MaxAggregateOutputType|GroupByOutputType/,
    "",
  );

  return modelName.length > 0 ? modelName : null;
}

function instantiatePayloadReferences(text: string): string {
  const modelNames = [
    ...Object.keys(MODEL_ID_MAP),
    "MatchRankHistory",
    "User",
    "GuildInstall",
    "BotState",
    "ActiveGame",
    "MatchAiAttempt",
  ].toSorted((left, right) => right.length - left.length);
  const payloadNames = modelNames
    .map((modelName) => String.raw`\$${modelName}Payload`)
    .join("|");

  return text
    .replaceAll(
      new RegExp(
        String.raw`\$Result\.DefaultSelection<Prisma\.(${payloadNames})>`,
        "g",
      ),
      "$Result.DefaultSelection<Prisma.$1<$Extensions.DefaultArgs>>",
    )
    .replaceAll(
      new RegExp(
        String.raw`\$Result\.GetResult<Prisma\.(${payloadNames}),`,
        "g",
      ),
      "$Result.GetResult<Prisma.$1<ExtArgs>,",
    )
    .replaceAll(
      new RegExp(
        String.raw`\$Utils\.PayloadToResult<Prisma\.(${payloadNames})>`,
        "g",
      ),
      "$Utils.PayloadToResult<Prisma.$1<ExtArgs>>",
    );
}

function insertBrandImports(text: string): string {
  if (BRANDED_TYPES_TO_IMPORT.size === 0) {
    return text;
  }

  const importLine = `import { ${[...BRANDED_TYPES_TO_IMPORT].toSorted().join(", ")} } from "@scout-for-lol/data";\n`;
  const existingImportPattern =
    /import(?:\s+type)?\s+\{[^}]+\}\s+from "@scout-for-lol\/data";\n/;

  if (existingImportPattern.test(text)) {
    return text.replace(existingImportPattern, importLine);
  }

  return `${importLine}${text.trimStart()}`;
}

const MODEL_ID_MAP: Record<string, string> = {
  Player: "PlayerId",
  Account: "AccountId",
  Competition: "CompetitionId",
  CompetitionParticipant: "ParticipantId",
  CompetitionSnapshot: "SnapshotId",
  Report: "ReportId",
  ReportRun: "ReportRunId",
  Subscription: "SubscriptionId",
  ServerPermission: "PermissionId",
  GuildPermissionError: "PermissionErrorId",
  ApiToken: "ApiTokenId",
  SoundPack: "SoundPackId",
  DesktopClient: "DesktopClientId",
  StoredSound: "StoredSoundId",
  GameEventLog: "GameEventLogId",
};

const FIELD_TYPE_MAP: Record<string, string> = {
  playerId: "PlayerId",
  competitionId: "CompetitionId",
  accountId: "AccountId",
  serverId: "DiscordGuildId",
  channelId: "DiscordChannelId",
  discordId: "DiscordAccountId",
  ownerId: "DiscordAccountId",
  creatorDiscordId: "DiscordAccountId",
  invitedBy: "DiscordAccountId",
  discordUserId: "DiscordAccountId",
  grantedBy: "DiscordAccountId",
  puuid: "LeaguePuuid",
  region: "Region",
  lastProcessedMatchId: "MatchId",
  visibility: "CompetitionVisibility",
  status: "ParticipantStatus",
  snapshotType: "SnapshotType",
  permission: "PermissionType",
  seasonId: "SeasonId",
  userId: "DiscordAccountId",
};

const MODEL_FIELD_TYPE_MAP: Record<string, Record<string, string>> = {
  Report: {
    outputFormat: "ReportOutputFormat",
    lastRunStatus: "ReportRunStatus",
    sourceCompetitionId: "CompetitionId",
    systemSource: "ReportSystemSource",
  },
  ReportRun: {
    reportId: "ReportId",
    trigger: "ReportRunTrigger",
    status: "ReportRunStatus",
    outputFormat: "ReportOutputFormat",
  },
};

function getBrandedType(
  propName: string,
  parentTypeName: string,
): string | null {
  if (propName === "id") {
    return MODEL_ID_MAP[parentTypeName] ?? null;
  }

  const modelFieldType = MODEL_FIELD_TYPE_MAP[parentTypeName]?.[propName];
  if (modelFieldType !== undefined) {
    return modelFieldType;
  }

  return FIELD_TYPE_MAP[propName] ?? null;
}

if (import.meta.main) {
  await brandPrismaTypes();
}
