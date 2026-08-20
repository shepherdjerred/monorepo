import { createKeyedSerialExecutor } from "#src/customs/keyed-serial.ts";

export const runCustomVoiceOperation = createKeyedSerialExecutor();

export function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length === 0 ? "Unknown Discord voice error" : message;
}
