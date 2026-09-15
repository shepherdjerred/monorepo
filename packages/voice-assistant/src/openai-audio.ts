import { z } from "zod";
import { encodePcm16MonoWave } from "./audio/wave-io.ts";

const TranscriptionResponseSchema = z.looseObject({ text: z.string() });
const OpenAiErrorResponseSchema = z.looseObject({
  error: z
    .looseObject({
      message: z.string().optional(),
      code: z.string().optional(),
      type: z.string().optional(),
    })
    .optional(),
});
type VoiceAudioFetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

async function requireOk(
  response: Response,
  operation: string,
): Promise<Response> {
  if (!response.ok) {
    const parsed = OpenAiErrorResponseSchema.safeParse(
      await response
        .clone()
        .json()
        .catch(() => null),
    );
    const providerError = parsed.success ? parsed.data.error : undefined;
    const marker = providerError?.code ?? providerError?.type;
    const cause =
      providerError?.message === undefined
        ? undefined
        : new Error(providerError.message);
    const error = new Error(
      `${operation} failed with HTTP ${response.status.toString()}${marker === undefined ? "" : ` (${marker})`}`,
      cause === undefined ? undefined : { cause },
    );
    if (providerError?.code !== undefined) {
      Object.assign(error, { code: providerError.code });
    }
    if (providerError?.type !== undefined) {
      Object.assign(error, { type: providerError.type });
    }
    throw error;
  }
  return response;
}

export async function transcribeVoiceQuestion(input: {
  apiKey: string;
  pcm16k: Float32Array;
  signal: AbortSignal;
  fetcher?: VoiceAudioFetcher;
}): Promise<string> {
  const body = new FormData();
  body.set("model", "gpt-4o-transcribe");
  body.set("language", "en");
  body.set(
    "file",
    new Blob([encodePcm16MonoWave(input.pcm16k, 16_000)], {
      type: "audio/wav",
    }),
    "question.wav",
  );
  const response = await requireOk(
    await (input.fetcher ?? fetch)(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${input.apiKey}` },
        body,
        signal: input.signal,
      },
    ),
    "Voice transcription",
  );
  return TranscriptionResponseSchema.parse(await response.json()).text;
}

export async function synthesizeVoiceAnswer(input: {
  apiKey: string;
  text: string;
  signal: AbortSignal;
  fetcher?: VoiceAudioFetcher;
}): Promise<Uint8Array> {
  const response = await requireOk(
    await (input.fetcher ?? fetch)("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice: "marin",
        input: input.text,
        response_format: "pcm",
      }),
      signal: input.signal,
    }),
    "Voice synthesis",
  );
  return new Uint8Array(await response.arrayBuffer());
}
