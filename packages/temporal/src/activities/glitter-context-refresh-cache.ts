import { z } from "zod/v4";
import { ApplicationFailure } from "@temporalio/common";
import { sha256 } from "#shared/glitter-corpus-projection.ts";
import {
  getObjectBytes,
  isPreconditionFailedError,
  putMutableJson,
  type CorpusStore,
} from "./glitter-corpus-store.ts";

const GENERATION_ARTIFACT_SCHEMA_VERSION = 3;
const GENERATION_SPEND_RECEIPT_SCHEMA_VERSION = 1;
const GENERATION_ARTIFACT_ROOT = "derived/glitter-context/generation-artifacts";
const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);
const CallSiteSchema = z.string().regex(/^[a-z0-9-]+$/u);

export const GenerationUsageSchema = z.strictObject({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
});
export type GenerationUsage = z.infer<typeof GenerationUsageSchema>;

const GenerationArtifactSchema = z.strictObject({
  schemaVersion: z.literal(GENERATION_ARTIFACT_SCHEMA_VERSION),
  ownerRunId: z.uuid(),
  model: z.string().min(1),
  callSite: CallSiteSchema,
  requestSha256: Sha256Schema,
  responseSha256: Sha256Schema,
  response: z.unknown(),
  usage: GenerationUsageSchema,
});

const GenerationSpendReceiptSchema = z.strictObject({
  schemaVersion: z.literal(GENERATION_SPEND_RECEIPT_SCHEMA_VERSION),
  ownerRunId: z.uuid(),
  model: z.string().min(1),
  callSite: CallSiteSchema,
  requestSha256: Sha256Schema,
  usage: GenerationUsageSchema,
});

export type GenerationArtifactStore = {
  ownerRunId: string;
  read: (key: string) => Promise<unknown>;
  create: (key: string, value: unknown) => Promise<void>;
};

function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

export function generationRequestSha256(request: unknown): string {
  return sha256(jsonBytes(request));
}

export function generationArtifactKey(input: {
  callSite: string;
  requestSha256: string;
}): string {
  const callSite = CallSiteSchema.parse(input.callSite);
  const requestSha256 = Sha256Schema.parse(input.requestSha256);
  return [
    GENERATION_ARTIFACT_ROOT,
    `v${String(GENERATION_ARTIFACT_SCHEMA_VERSION)}`,
    callSite,
    `${requestSha256}.json`,
  ].join("/");
}

export function generationSpendReceiptKey(input: {
  ownerRunId: string;
  callSite: string;
  requestSha256: string;
}): string {
  const ownerRunId = z.uuid().parse(input.ownerRunId);
  const callSite = CallSiteSchema.parse(input.callSite);
  const requestSha256 = Sha256Schema.parse(input.requestSha256);
  return [
    GENERATION_ARTIFACT_ROOT,
    `v${String(GENERATION_ARTIFACT_SCHEMA_VERSION)}`,
    "run-spend",
    `v${String(GENERATION_SPEND_RECEIPT_SCHEMA_VERSION)}`,
    ownerRunId,
    callSite,
    `${requestSha256}.json`,
  ].join("/");
}

export type GenerationArtifactResult<Response> = {
  response: Response;
  key: string;
  requestSha256: string;
  cacheStatus: "hit" | "miss";
  billedToCurrentRun: boolean;
  usage: GenerationUsage;
};

function billedGenerationFinalizationFailure(input: {
  error: unknown;
  key: string;
  model: string;
  callSite: string;
  ownerRunId: string;
  requestSha256: string;
  usage: GenerationUsage;
}): ApplicationFailure {
  const reason =
    input.error instanceof Error ? input.error.message : String(input.error);
  return ApplicationFailure.nonRetryable(
    `A billed Glitter completion could not be finalized into its immutable artifact at ${input.key}: ${reason}. Automatic retry is disabled to prevent rebilling the same request; inspect storage and rerun deliberately.`,
    "BilledGenerationFinalizationError",
    {
      key: input.key,
      model: input.model,
      callSite: input.callSite,
      ownerRunId: input.ownerRunId,
      requestSha256: input.requestSha256,
      usage: input.usage,
      reason,
    },
  );
}

function parseStoredResponse<Response>(input: {
  stored: unknown;
  key: string;
  cacheStatus: "hit" | "miss";
  model: string;
  callSite: string;
  ownerRunId: string;
  requestSha256: string;
  responseSchema: z.ZodType<Response>;
}): GenerationArtifactResult<Response> {
  const artifact = GenerationArtifactSchema.parse(input.stored);
  if (
    artifact.model !== input.model ||
    artifact.callSite !== input.callSite ||
    artifact.requestSha256 !== input.requestSha256
  ) {
    throw new Error(
      `Glitter generation artifact identity mismatch for ${input.callSite}`,
    );
  }
  const response = input.responseSchema.parse(artifact.response);
  const responseSha256 = sha256(jsonBytes(response));
  if (responseSha256 !== artifact.responseSha256) {
    throw new Error(
      `Glitter generation artifact response checksum mismatch for ${input.callSite}`,
    );
  }
  return {
    response,
    key: input.key,
    requestSha256: input.requestSha256,
    cacheStatus: input.cacheStatus,
    billedToCurrentRun: artifact.ownerRunId === input.ownerRunId,
    usage: artifact.usage,
  };
}

function parseSpendReceipt(input: {
  stored: unknown;
  ownerRunId: string;
  model: string;
  callSite: string;
  requestSha256: string;
}): GenerationUsage {
  const receipt = GenerationSpendReceiptSchema.parse(input.stored);
  if (
    receipt.ownerRunId !== input.ownerRunId ||
    receipt.model !== input.model ||
    receipt.callSite !== input.callSite ||
    receipt.requestSha256 !== input.requestSha256
  ) {
    throw new Error(
      `Glitter generation spend receipt identity mismatch for ${input.callSite}`,
    );
  }
  return receipt.usage;
}

export async function readOrCreateGenerationArtifact<Response>(input: {
  store: GenerationArtifactStore;
  model: string;
  callSite: string;
  request: unknown;
  responseSchema: z.ZodType<Response>;
  generate: () => Promise<{
    response: Response;
    usage: GenerationUsage;
  }>;
}): Promise<GenerationArtifactResult<Response>> {
  const requestSha256 = generationRequestSha256(input.request);
  const key = generationArtifactKey({
    callSite: input.callSite,
    requestSha256,
  });
  const spendReceiptKey = generationSpendReceiptKey({
    ownerRunId: input.store.ownerRunId,
    callSite: input.callSite,
    requestSha256,
  });
  const existing = await input.store.read(key);
  if (existing !== undefined) {
    const persistedResult = parseStoredResponse({
      stored: existing,
      key,
      cacheStatus: "hit",
      model: input.model,
      callSite: input.callSite,
      ownerRunId: input.store.ownerRunId,
      requestSha256,
      responseSchema: input.responseSchema,
    });
    const storedSpendReceipt = await input.store.read(spendReceiptKey);
    if (storedSpendReceipt === undefined) {
      return persistedResult;
    }
    return {
      response: persistedResult.response,
      key: persistedResult.key,
      requestSha256: persistedResult.requestSha256,
      cacheStatus: persistedResult.cacheStatus,
      billedToCurrentRun: true,
      usage: parseSpendReceipt({
        stored: storedSpendReceipt,
        ownerRunId: input.store.ownerRunId,
        model: input.model,
        callSite: input.callSite,
        requestSha256,
      }),
    };
  }

  const orphanedSpendReceipt = await input.store.read(spendReceiptKey);
  if (orphanedSpendReceipt !== undefined) {
    const usage = parseSpendReceipt({
      stored: orphanedSpendReceipt,
      ownerRunId: input.store.ownerRunId,
      model: input.model,
      callSite: input.callSite,
      requestSha256,
    });
    throw ApplicationFailure.nonRetryable(
      `Glitter run ${input.store.ownerRunId} already paid for ${input.callSite} request ${requestSha256}, but its response artifact is missing. Automatic regeneration is disabled to prevent rebilling.`,
      "BilledGenerationReceiptWithoutArtifact",
      {
        key,
        spendReceiptKey,
        ownerRunId: input.store.ownerRunId,
        model: input.model,
        callSite: input.callSite,
        requestSha256,
        usage,
      },
    );
  }

  const generated = await input.generate();
  const reportedUsage = generated.usage;
  try {
    const usage = GenerationUsageSchema.parse(reportedUsage);
    await input.store.create(
      spendReceiptKey,
      GenerationSpendReceiptSchema.parse({
        schemaVersion: GENERATION_SPEND_RECEIPT_SCHEMA_VERSION,
        ownerRunId: input.store.ownerRunId,
        model: input.model,
        callSite: input.callSite,
        requestSha256,
        usage,
      }),
    );
    const persistedSpendReceipt = await input.store.read(spendReceiptKey);
    if (persistedSpendReceipt === undefined) {
      throw new Error(
        `Glitter generation spend receipt disappeared after creation: ${spendReceiptKey}`,
      );
    }
    parseSpendReceipt({
      stored: persistedSpendReceipt,
      ownerRunId: input.store.ownerRunId,
      model: input.model,
      callSite: input.callSite,
      requestSha256,
    });
    const response = input.responseSchema.parse(generated.response);
    await input.store.create(
      key,
      GenerationArtifactSchema.parse({
        schemaVersion: GENERATION_ARTIFACT_SCHEMA_VERSION,
        ownerRunId: input.store.ownerRunId,
        model: input.model,
        callSite: input.callSite,
        requestSha256,
        responseSha256: sha256(jsonBytes(response)),
        response,
        usage,
      }),
    );

    const persisted = await input.store.read(key);
    if (persisted === undefined) {
      throw new Error(
        `Glitter generation artifact disappeared after creation: ${key}`,
      );
    }
    const persistedResult = parseStoredResponse({
      stored: persisted,
      key,
      cacheStatus: "miss",
      model: input.model,
      callSite: input.callSite,
      ownerRunId: input.store.ownerRunId,
      requestSha256,
      responseSchema: input.responseSchema,
    });
    return {
      response: persistedResult.response,
      key: persistedResult.key,
      requestSha256: persistedResult.requestSha256,
      cacheStatus: persistedResult.cacheStatus,
      billedToCurrentRun: true,
      // A conditional-create loser must reuse the winner's response while
      // charging this execution for its own already-billed completion.
      usage,
    };
  } catch (error: unknown) {
    throw billedGenerationFinalizationFailure({
      error,
      key,
      model: input.model,
      callSite: input.callSite,
      ownerRunId: input.store.ownerRunId,
      requestSha256,
      usage: reportedUsage,
    });
  }
}

export function createCorpusGenerationArtifactStore(
  store: CorpusStore,
  ownerRunId: string,
): GenerationArtifactStore {
  const parsedOwnerRunId = z.uuid().parse(ownerRunId);
  const guildId = z
    .string()
    .regex(/^\d+$/u)
    .parse(Bun.env["GLITTER_DISCORD_GUILD_ID"]);
  const scopedKey = (key: string) => `guilds/${guildId}/${key}`;
  return {
    ownerRunId: parsedOwnerRunId,
    read: async (key) => {
      const bytes = await getObjectBytes(store, scopedKey(key));
      return bytes === undefined
        ? undefined
        : (JSON.parse(new TextDecoder().decode(bytes)) as unknown);
    },
    create: async (key, value) => {
      try {
        await putMutableJson(store, scopedKey(key), value, undefined);
      } catch (error: unknown) {
        if (!isPreconditionFailedError(error)) {
          throw error;
        }
      }
    },
  };
}
