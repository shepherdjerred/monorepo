import { z } from "zod/v4";
import { sha256 } from "#shared/glitter-corpus-projection.ts";
import {
  getObjectBytes,
  isPreconditionFailedError,
  putMutableJson,
  type CorpusStore,
} from "./glitter-corpus-store.ts";

const GENERATION_ARTIFACT_SCHEMA_VERSION = 1;
const GENERATION_ARTIFACT_ROOT = "derived/glitter-context/generation-artifacts";
const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);
const CallSiteSchema = z.string().regex(/^[a-z0-9-]+$/u);

const GenerationArtifactSchema = z.strictObject({
  schemaVersion: z.literal(GENERATION_ARTIFACT_SCHEMA_VERSION),
  model: z.string().min(1),
  callSite: CallSiteSchema,
  requestSha256: Sha256Schema,
  responseSha256: Sha256Schema,
  response: z.unknown(),
});

export type GenerationArtifactStore = {
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

function parseStoredResponse<Response>(input: {
  stored: unknown;
  model: string;
  callSite: string;
  requestSha256: string;
  responseSchema: z.ZodType<Response>;
}): Response {
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
  return response;
}

export async function readOrCreateGenerationArtifact<Response>(input: {
  store: GenerationArtifactStore;
  model: string;
  callSite: string;
  request: unknown;
  responseSchema: z.ZodType<Response>;
  generate: () => Promise<Response>;
}): Promise<Response> {
  const requestSha256 = generationRequestSha256(input.request);
  const key = generationArtifactKey({
    callSite: input.callSite,
    requestSha256,
  });
  const existing = await input.store.read(key);
  if (existing !== undefined) {
    return parseStoredResponse({
      stored: existing,
      model: input.model,
      callSite: input.callSite,
      requestSha256,
      responseSchema: input.responseSchema,
    });
  }

  const response = input.responseSchema.parse(await input.generate());
  await input.store.create(
    key,
    GenerationArtifactSchema.parse({
      schemaVersion: GENERATION_ARTIFACT_SCHEMA_VERSION,
      model: input.model,
      callSite: input.callSite,
      requestSha256,
      responseSha256: sha256(jsonBytes(response)),
      response,
    }),
  );

  const persisted = await input.store.read(key);
  if (persisted === undefined) {
    throw new Error(
      `Glitter generation artifact disappeared after creation: ${key}`,
    );
  }
  return parseStoredResponse({
    stored: persisted,
    model: input.model,
    callSite: input.callSite,
    requestSha256,
    responseSchema: input.responseSchema,
  });
}

export function createCorpusGenerationArtifactStore(
  store: CorpusStore,
): GenerationArtifactStore {
  const guildId = z
    .string()
    .regex(/^\d+$/u)
    .parse(Bun.env["GLITTER_DISCORD_GUILD_ID"]);
  const scopedKey = (key: string) => `guilds/${guildId}/${key}`;
  return {
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
