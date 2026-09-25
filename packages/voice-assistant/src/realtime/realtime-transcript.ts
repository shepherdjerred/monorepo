export function buildRealtimeSessionConfig(options: {
  readonly assistantVoice: string;
  readonly transcriptionModel?: string;
}) {
  return {
    outputModalities: ["audio"] as const,
    parallelToolCalls: false,
    audio: {
      input: {
        format: { type: "audio/pcm" as const, rate: 24_000 },
        transcription: {
          model: options.transcriptionModel ?? "gpt-transcribe",
          language: "en",
        },
        turnDetection: null,
        noiseReduction: null,
      },
      output: {
        format: { type: "audio/pcm" as const, rate: 24_000 },
        voice: options.assistantVoice,
      },
    },
  };
}

export type VerifiedWakeTranscript = {
  readonly normalized: string;
  readonly command: string;
};

export function normalizeTranscript(transcript: string): string {
  return transcript
    .toLocaleLowerCase("en-US")
    .replaceAll(/[^a-z0-9\s]/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
}

/** Strict final wake gate. A configured phrase must be the leading normalized words. */
export function verifyWakeTranscript(
  transcript: string,
  wakePrefixes: readonly string[],
): VerifiedWakeTranscript | null {
  const normalized = normalizeTranscript(transcript);
  for (const prefix of wakePrefixes) {
    if (normalized === prefix) return { normalized, command: "" };
    if (normalized.startsWith(`${prefix} `)) {
      return { normalized, command: normalized.slice(prefix.length + 1) };
    }
  }
  return null;
}
