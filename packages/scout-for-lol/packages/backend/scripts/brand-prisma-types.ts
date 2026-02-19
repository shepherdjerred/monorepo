#!/usr/bin/env bun
/**
 * Post-process Prisma generated types to use branded IDs
 *
 * This script uses TypeScript's AST to properly transform the generated
 * Prisma types, replacing number IDs with branded types from @scout-for-lol/data
 *
 * Usage:
 *   bun run scripts/brand-prisma-types.ts
 *
 * This should be run after `prisma generate`
 */

import {
  Project,
  SyntaxKind,
  type TypeAliasDeclaration,
  type InterfaceDeclaration,
  type PropertySignature,
} from "ts-morph";
import { createLogger } from "@scout-for-lol/backend/logger.ts";

const logger = createLogger("brand-prisma-types");

// Types that need to be imported
const BRANDED_TYPES_TO_IMPORT = new Set<string>();

function main() {
  logger.info("🔧 Branding Prisma types with AST transformation...");

  const project = new Project({
    tsConfigFilePath: `${import.meta.dir}/../tsconfig.json`,
    skipAddingFilesFromTsConfig: true, // Avoid loading all files to prevent stack overflow
  });

  const prismaTypesPath = `${import.meta.dir}/../generated/prisma/client/index.d.ts`;
  const sourceFile = project.addSourceFileAtPath(prismaTypesPath);

  logger.info(`📄 Processing: ${prismaTypesPath}`);

  // Track how many properties we transform
  let transformCount = 0;

  // Find the Prisma namespace
  const prismaNamespace = sourceFile.getModule("Prisma");
  if (!prismaNamespace) {
    logger.error("❌ Could not find Prisma namespace!");
    return;
  }

  // Process all type aliases inside the Prisma namespace
  const typeAliases = prismaNamespace.getTypeAliases();

  for (const typeAlias of typeAliases) {
    const typeName = typeAlias.getName();

    // Process Payload types (return types)
    if (typeName.startsWith("$") && typeName.endsWith("Payload")) {
      transformCount += transformPayloadType(typeAlias);
    }
    // Process Where input types (query filters)
    else if (
      typeName.includes("WhereUniqueInput") ||
      typeName.includes("WhereInput")
    ) {
      transformCount += transformWhereType(typeAlias);
    }
    // Process Create input types (all variations)
    // Patterns: CreateInput, CreateManyInput, CreateWithout...Input, Unchecked variants
    else if (typeName.includes("Create") && typeName.endsWith("Input")) {
      transformCount += transformInputType(typeAlias);
    }
    // Process Update input types (all variations)
    // Patterns: UpdateInput, UpdateManyInput, UpdateWithout...Input, Unchecked variants
    else if (typeName.includes("Update") && typeName.endsWith("Input")) {
      transformCount += transformInputType(typeAlias);
    }
    // Process Min/Max Aggregate output types (return actual values, not counts)
    else if (
      typeName.includes("MinAggregateOutputType") ||
      typeName.includes("MaxAggregateOutputType")
    ) {
      transformCount += transformAggregateType(typeAlias);
    }
    // Process GroupBy output types (return actual values)
    else if (typeName.includes("GroupByOutputType")) {
      transformCount += transformAggregateType(typeAlias);
    }
  }

  // Process all interfaces inside the Prisma namespace
  const interfaces = prismaNamespace.getInterfaces();
  for (const interfaceDecl of interfaces) {
    const interfaceName = interfaceDecl.getName();

    // Process FieldRefs interfaces (for query building)
    if (interfaceName.endsWith("FieldRefs")) {
      transformCount += transformFieldRefsInterface(interfaceDecl);
    }
  }

  // Add imports for branded types at the top of the file
  if (BRANDED_TYPES_TO_IMPORT.size > 0) {
    sourceFile.insertImportDeclaration(0, {
      moduleSpecifier: "@scout-for-lol/data",
      namedImports: [...BRANDED_TYPES_TO_IMPORT].toSorted(),
    });
  }

  // Debug: Check if file was actually modified
  const wasModified =
    sourceFile.getImportDeclarations().length > 0 || transformCount > 0;
  logger.info(`File was modified: ${wasModified.toString()}`);
  logger.info(
    `Import declarations before save: ${sourceFile.getImportDeclarations().length.toString()}`,
  );

  // Save the transformed file
  sourceFile.saveSync();
  logger.info("Save completed");

  logger.info(`✅ Transformed ${transformCount.toString()} properties`);
  logger.info(
    `✅ Added imports: ${[...BRANDED_TYPES_TO_IMPORT].join(", ")}`,
  );
  logger.info("🎉 Prisma types successfully branded!");
}

function transformFieldTypeInContent(
  content: string,
  fieldPattern: RegExp,
  baseType: "number" | "string",
  modelName: string,
): { transformed: string; count: number } {
  let transformedContent = content;
  let count = 0;
  let match = fieldPattern.exec(content);

  while (match !== null) {
    const fieldName = match[1];
    if (fieldName === undefined) {
      match = fieldPattern.exec(content);
      continue;
    }

    const isNullable = match[2] !== undefined;
    const originalType = `${baseType}${match[2] ?? ""}`;

    const brandedType = getBrandedType(fieldName, modelName);
    if (brandedType !== null && brandedType.length > 0) {
      const newType = isNullable ? `${brandedType} | null` : brandedType;
      const fieldReplacePattern = new RegExp(
        String.raw`${fieldName}:\s*${baseType}(\s*\|\s*null)?`,
      );
      transformedContent = transformedContent.replace(
        fieldReplacePattern,
        `${fieldName}: ${newType}`,
      );

      BRANDED_TYPES_TO_IMPORT.add(brandedType);
      count++;

      logger.info(
        `    ✓ ${modelName}.${fieldName}: ${originalType} → ${newType}`,
      );
    }

    match = fieldPattern.exec(content);
  }

  return { transformed: transformedContent, count };
}

function extractScalarsContent(prop: PropertySignature): string | null {
  const scalarTypeNode = prop.getTypeNode();
  if (!scalarTypeNode) {
    return null;
  }

  const typeArgs = scalarTypeNode.getType().getAliasTypeArguments();
  if (typeArgs.length === 0) {
    return null;
  }

  const fullText = prop.getText();
  const payloadPattern = /\$Extensions\.GetPayloadResult<\s*\{([^}]+)\}/;
  const match = payloadPattern.exec(fullText);
  return match?.[1] ?? null;
}

function transformPayloadType(typeAlias: TypeAliasDeclaration): number {
  const payloadName = typeAlias.getName(); // e.g., "$PlayerPayload"
  const modelName = payloadName.replace(/^\$/, "").replace(/Payload$/, ""); // e.g., "Player"

  logger.info(`Processing ${modelName}...`);

  const typeNode = typeAlias.getTypeNode();
  if (typeNode?.getKind() !== SyntaxKind.TypeLiteral) {
    return 0;
  }

  const typeLiteral = typeNode.asKindOrThrow(SyntaxKind.TypeLiteral);
  let totalCount = 0;

  // Find the 'scalars' property
  for (const member of typeLiteral.getMembers()) {
    if (member.getKind() !== SyntaxKind.PropertySignature) {
      continue;
    }

    const prop = member.asKindOrThrow(SyntaxKind.PropertySignature);
    if (prop.getName() !== "scalars") {
      continue;
    }

    const objectContent = extractScalarsContent(prop);
    if (objectContent === null) {
      continue;
    }

    const fullText = prop.getText();

    // Transform number fields
    const numberResult = transformFieldTypeInContent(
      objectContent,
      /(\w+):\s*number(\s*\|\s*null)?/g,
      "number",
      modelName,
    );

    // Transform string fields
    const stringResult = transformFieldTypeInContent(
      numberResult.transformed,
      /(\w+):\s*string(\s*\|\s*null)?/g,
      "string",
      modelName,
    );

    totalCount += numberResult.count + stringResult.count;

    // Replace the entire scalars property with the transformed version
    if (totalCount > 0) {
      const newScalarsText = fullText.replace(
        objectContent,
        stringResult.transformed,
      );
      prop.replaceWithText(newScalarsText);
    }
  }

  return totalCount;
}

function transformWhereType(typeAlias: TypeAliasDeclaration): number {
  const typeName = typeAlias.getName();
  // Extract model name: PlayerWhereUniqueInput → Player
  const modelName = typeName.replace(/WhereUniqueInput|WhereInput/, "");

  return transformSimpleObjectType(typeAlias, modelName);
}

function transformInputType(typeAlias: TypeAliasDeclaration): number {
  const typeName = typeAlias.getName();
  // Extract model name from various input type patterns
  // Must check longer patterns first to avoid partial matches
  // Patterns like "PlayerCreateWithoutSubscriptionsInput" -> "Player"
  // Patterns like "AccountCreateManyPlayerInput" -> "Account"
  const modelName = typeName.replace(
    /UncheckedCreateWithout\w+Input|UncheckedUpdateWithout\w+Input|UncheckedCreateInput|UncheckedUpdateInput|CreateWithout\w+Input|UpdateWithout\w+Input|CreateMany\w+Input|UpdateMany\w+Input|CreateInput|UpdateInput/,
    "",
  );

  return transformSimpleObjectType(typeAlias, modelName);
}

/**
 * Transform a property signature if it has a branded type
 * Returns true if transformation occurred, false otherwise
 */
function transformPropertyType(
  prop: PropertySignature,
  modelName: string,
  transformFn: (
    fullText: string,
    brandedType: string,
    propName: string,
  ) => string | null,
): boolean {
  const propName = prop.getName();
  const propTypeNode = prop.getTypeNode();

  if (!propTypeNode) {
    return false;
  }

  const brandedType = getBrandedType(propName, modelName);
  if (brandedType === null) {
    return false;
  }

  const fullText = prop.getText();
  const newText = transformFn(fullText, brandedType, propName);

  if (newText !== null && newText.length > 0) {
    prop.replaceWithText(newText);
    BRANDED_TYPES_TO_IMPORT.add(brandedType);
    return true;
  }

  return false;
}

function transformSimpleObjectType(
  typeAlias: TypeAliasDeclaration,
  modelName: string,
): number {
  const typeNode = typeAlias.getTypeNode();
  if (typeNode?.getKind() !== SyntaxKind.TypeLiteral) {
    return 0;
  }

  const typeLiteral = typeNode.asKindOrThrow(SyntaxKind.TypeLiteral);
  let count = 0;

  for (const member of typeLiteral.getMembers()) {
    if (member.getKind() !== SyntaxKind.PropertySignature) {
      continue;
    }

    const prop = member.asKindOrThrow(SyntaxKind.PropertySignature);

    // Match patterns like: id?: number | IntFieldUpdateOperationsInput
    // OR: serverId?: string | StringFilter
    // We want to brand the primitive type part while keeping other types
    const transformed = transformPropertyType(
      prop,
      modelName,
      (fullText, brandedType, propName) => {
        const simpleNumberPattern = new RegExp(String.raw`${propName}\??:\s*number\b`);
        const simpleStringPattern = new RegExp(String.raw`${propName}\??:\s*string\b`);

        const numberMatch = simpleNumberPattern.exec(fullText);
        const stringMatch = simpleStringPattern.exec(fullText);

        if (numberMatch) {
          return fullText.replace(/:\s*number\b/, `: ${brandedType}`);
        }

        if (stringMatch) {
          return fullText.replace(/:\s*string\b/, `: ${brandedType}`);
        }

        // Match union patterns: number | SomeOtherType OR string | SomeOtherType
        const unionPattern = new RegExp(String.raw`${propName}\??:\s*([^\n]+)`);
        const unionMatch = unionPattern.exec(fullText);
        if (unionMatch?.[1] !== undefined && unionMatch[1].length > 0) {
          const typeExpression = unionMatch[1];
          if (typeExpression.includes("number")) {
            return fullText.replace(/\bnumber\b/, brandedType);
          }
          if (typeExpression.includes("string")) {
            return fullText.replace(/\bstring\b/, brandedType);
          }
        }

        return null;
      },
    );

    if (transformed) {
      count++;
    }
  }

  return count;
}

function transformAggregateType(typeAlias: TypeAliasDeclaration): number {
  const typeName = typeAlias.getName();
  // Extract model name: SubscriptionMinAggregateOutputType → Subscription
  // or SubscriptionGroupByOutputType → Subscription
  const modelName = typeName.replace(
    /MinAggregateOutputType|MaxAggregateOutputType|GroupByOutputType/,
    "",
  );

  return transformSimpleObjectType(typeAlias, modelName);
}

function transformFieldRefsInterface(
  interfaceDecl: InterfaceDeclaration,
): number {
  const interfaceName = interfaceDecl.getName();
  // Extract model name: SubscriptionFieldRefs → Subscription
  const modelName = interfaceName.replace(/FieldRefs$/, "");

  let count = 0;

  for (const member of interfaceDecl.getMembers()) {
    if (member.getKind() !== SyntaxKind.PropertySignature) {
      continue;
    }

    const prop = member.asKindOrThrow(SyntaxKind.PropertySignature);

    // FieldRef pattern: readonly channelId: FieldRef<"Subscription", 'String'>
    // We need to replace the second type parameter with the branded type
    // Pattern: FieldRef<"Model", 'Int'> → FieldRef<"Model", BrandedType>
    // Pattern: FieldRef<"Model", 'String'> → FieldRef<"Model", BrandedType>
    const transformed = transformPropertyType(
      prop,
      modelName,
      (fullText, brandedType, _propName) => {
        // Match the FieldRef type parameter (Int, String, DateTime, etc.)
        const fieldRefPattern =
          /FieldRef<"[^"]+",\s*'(Int|String|DateTime|Boolean|Float|Decimal|BigInt|Bytes|Json)'\s*>/;
        const match = fieldRefPattern.exec(fullText);

        if (match) {
          // Replace the type parameter with the branded type (without quotes since it's a type, not a string literal)
          return fullText.replace(
            fieldRefPattern,
            `FieldRef<"${modelName}", ${brandedType}>`,
          );
        }

        return null;
      },
    );

    if (transformed) {
      count++;
    }
  }

  return count;
}

// Model-specific ID mappings
const MODEL_ID_MAP: Record<string, string> = {
  Player: "PlayerId",
  Account: "AccountId",
  Competition: "CompetitionId",
  CompetitionParticipant: "ParticipantId",
  CompetitionSnapshot: "SnapshotId",
  Subscription: "SubscriptionId",
  ServerPermission: "PermissionId",
  GuildPermissionError: "PermissionErrorId",
  // Voice notification system models
  // Note: User uses discordId as primary key, so no UserId type needed
  ApiToken: "ApiTokenId",
  SoundPack: "SoundPackId",
  DesktopClient: "DesktopClientId",
  StoredSound: "StoredSoundId",
  GameEventLog: "GameEventLogId",
};

// Field name to branded type mappings
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
  // Voice notification system - userId is a Discord ID foreign key
  userId: "DiscordAccountId",
};

function getBrandedType(
  propName: string,
  parentTypeName: string,
): string | null {
  // Check if this is an 'id' field with model-specific branding
  if (propName === "id") {
    return MODEL_ID_MAP[parentTypeName] ?? null;
  }

  // Check other field mappings
  return FIELD_TYPE_MAP[propName] ?? null;
}

// Run the script
main();
