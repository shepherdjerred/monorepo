import {
  ReportAiEditRequestSchema,
  ReportAiHttpErrorSchema,
  ReportAiStreamEventSchema,
  type ReportAiEditRequest,
  type ReportAiStreamEvent,
} from "@scout-for-lol/data";
import { readCsrfCookie } from "#src/lib/trpc.ts";

export async function streamReportAiEdit(params: {
  input: ReportAiEditRequest;
  signal: AbortSignal;
  onEvent: (event: ReportAiStreamEvent) => void;
}): Promise<void> {
  const input = ReportAiEditRequestSchema.parse(params.input);
  const csrf = readCsrfCookie();
  const headers = new Headers({ "Content-Type": "application/json" });
  if (csrf !== null) {
    headers.set("X-CSRF-Token", csrf);
  }

  const response = await fetch("/api/reports/query-agent/stream", {
    method: "POST",
    credentials: "include",
    headers,
    body: JSON.stringify(input),
    signal: params.signal,
  });

  if (!response.ok) {
    await throwStreamHttpError(response);
  }

  if (response.body === null) {
    throw new Error("AI report stream returned an empty response.");
  }

  await readEventStream(response.body, params.onEvent);
}

async function throwStreamHttpError(response: Response): Promise<never> {
  const text = await response.text();
  if (text.length === 0) {
    throw new Error(
      `AI report request failed (${response.status.toString()}).`,
    );
  }

  let parsedMessage: string | null = null;
  try {
    const raw: unknown = JSON.parse(text);
    const parsed = ReportAiHttpErrorSchema.safeParse(raw);
    if (parsed.success) {
      parsedMessage = parsed.data.error;
    }
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }
  }

  throw new Error(parsedMessage ?? text);
}

async function readEventStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: ReportAiStreamEvent) => void,
): Promise<void> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buffer = "";

  try {
    let read = await reader.read();
    while (!read.done) {
      buffer += decoder.decode(read.value, { stream: true });
      buffer = processBufferedEvents(buffer, onEvent);
      read = await reader.read();
    }

    buffer += decoder.decode();
    if (buffer.trim().length > 0) {
      processEventBlock(buffer, onEvent);
    }
  } finally {
    reader.releaseLock();
  }
}

function processBufferedEvents(
  buffer: string,
  onEvent: (event: ReportAiStreamEvent) => void,
): string {
  const blocks = buffer.split("\n\n");
  const remainder = blocks.pop() ?? "";
  for (const block of blocks) {
    processEventBlock(block, onEvent);
  }
  return remainder;
}

function processEventBlock(
  block: string,
  onEvent: (event: ReportAiStreamEvent) => void,
): void {
  const dataLine = block.split("\n").find((line) => line.startsWith("data: "));
  if (dataLine === undefined) {
    return;
  }

  let event: ReportAiStreamEvent;
  try {
    const raw: unknown = JSON.parse(dataLine.slice("data: ".length));
    event = ReportAiStreamEventSchema.parse(raw);
  } catch {
    // The backend validates every event before emitting, so a frame that
    // fails to parse here means the stream was corrupted in transit (e.g. a
    // proxy mangled a chunk). Surface a friendly message instead of leaking a
    // raw "Unexpected token …" / Zod error to the user.
    throw new Error("The AI report stream was corrupted. Please try again.");
  }
  onEvent(event);
}
