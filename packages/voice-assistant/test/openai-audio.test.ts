import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  synthesizeVoiceAnswer,
  transcribeVoiceQuestion,
} from "@shepherdjerred/voice-assistant/openai-audio.ts";
import { isQuotaExhaustedError } from "@shepherdjerred/voice-assistant/quota-errors.ts";

function requestFromFetch(
  input: string | URL | Request,
  init: RequestInit | undefined,
): Request {
  return input instanceof Request
    ? new Request(input, init)
    : new Request(input.toString(), init);
}

describe("OpenAI voice audio adapter", () => {
  test("sends a bounded PCM wave to the transcription endpoint", async () => {
    let request: Request | undefined;
    let submittedForm: FormData | undefined;
    const text = await transcribeVoiceQuestion({
      apiKey: "secret-test-key",
      pcm16k: new Float32Array([0, 0.5, -0.5]),
      signal: new AbortController().signal,
      fetcher: (input, init) => {
        request = requestFromFetch(input, init);
        if (init?.body instanceof FormData) submittedForm = init.body;
        return Promise.resolve(
          Response.json({ text: "Hey Scout, who wins?", usage: {} }),
        );
      },
    });

    expect(text).toBe("Hey Scout, who wins?");
    expect(request?.url).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect(submittedForm?.get("model")).toBe("gpt-4o-transcribe");
    const file = submittedForm?.get("file");
    expect(file).toBeInstanceOf(Blob);
    if (!(file instanceof Blob)) throw new Error("Missing transcription wave");
    const contents = await file.arrayBuffer();
    expect(new TextDecoder().decode(contents.slice(0, 4))).toBe("RIFF");
  });

  test("requests raw 24 kHz PCM speech with the Scout voice", async () => {
    let request: Request | undefined;
    const pcm = await synthesizeVoiceAnswer({
      apiKey: "secret-test-key",
      text: "A concise answer.",
      signal: new AbortController().signal,
      fetcher: (input, init) => {
        request = requestFromFetch(input, init);
        return Promise.resolve(new Response(new Uint8Array([1, 0, 2, 0])));
      },
    });

    expect([...pcm]).toEqual([1, 0, 2, 0]);
    expect(request?.url).toBe("https://api.openai.com/v1/audio/speech");
    const body = z
      .object({
        model: z.string(),
        voice: z.string(),
        input: z.string(),
        response_format: z.string(),
      })
      .parse(JSON.parse((await request?.text()) ?? "null"));
    expect(body).toEqual({
      model: "gpt-4o-mini-tts",
      voice: "marin",
      input: "A concise answer.",
      response_format: "pcm",
    });
  });

  test("preserves a structured quota marker without exposing the provider body", async () => {
    let error: unknown;
    try {
      await transcribeVoiceQuestion({
        apiKey: "secret-test-key",
        pcm16k: new Float32Array([0]),
        signal: new AbortController().signal,
        fetcher: () =>
          Promise.resolve(
            Response.json(
              {
                error: {
                  message: "You exceeded your current quota. Secret detail.",
                  code: "insufficient_quota",
                  type: "insufficient_quota",
                },
              },
              { status: 429 },
            ),
          ),
      });
    } catch (error_) {
      error = error_;
    }

    expect(error).toBeInstanceOf(Error);
    if (!(error instanceof Error)) throw new Error("Expected adapter error");
    expect(error.message).toBe(
      "Voice transcription failed with HTTP 429 (insufficient_quota)",
    );
    expect(error.message).not.toContain("Secret detail");
    expect(isQuotaExhaustedError(error)).toBe(true);
  });
});
