/**
 * NDJSON Stream Processing
 * Utilities for processing A2UI message streams
 */

import type { A2UIMessage } from "./types.js";
import { SurfaceManager } from "./surface-manager.js";
import type { DiscordMessagePayload } from "./renderer.js";

/**
 * Parse a single NDJSON line
 */
export function parseNdjsonLine(line: string): A2UIMessage | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed) as A2UIMessage;
  } catch {
    return null;
  }
}

/**
 * Parse multiple NDJSON lines
 */
export function parseNdjson(ndjson: string): A2UIMessage[] {
  const lines = ndjson.split("\n");
  const messages: A2UIMessage[] = [];

  for (const line of lines) {
    const message = parseNdjsonLine(line);
    if (message) {
      messages.push(message);
    }
  }

  return messages;
}

/**
 * Options for stream processing
 */
export type StreamProcessorOptions = {
  /**
   * Called when a surface becomes renderable
   */
  onRender?: (surfaceId: string, payload: DiscordMessagePayload) => void | Promise<void>;

  /**
   * Called when an error occurs during processing
   */
  onError?: (error: Error) => void;

  /**
   * Called when the stream ends
   */
  onEnd?: () => void | Promise<void>;
};

/**
 * Process an NDJSON stream and emit Discord payloads
 */
export async function processStream(
  stream: ReadableStream<Uint8Array>,
  manager: SurfaceManager,
  options: StreamProcessorOptions = {}
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        // Process any remaining buffer
        if (buffer.trim()) {
          const message = parseNdjsonLine(buffer);
          if (message) {
            manager.processMessage(message);
          }
        }
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");

      // Keep the last (potentially incomplete) line in the buffer
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const message = parseNdjsonLine(line);
        if (message) {
          manager.processMessage(message);

          // Check if any surface is now renderable
          if (options.onRender) {
            for (const surface of manager.getRenderableSurfaces()) {
              const payload = manager.renderSurface(surface.id);
              if (payload) {
                await options.onRender(surface.id, payload);
              }
            }
          }
        }
      }
    }

    // Final render check
    if (options.onRender) {
      for (const surface of manager.getRenderableSurfaces()) {
        const payload = manager.renderSurface(surface.id);
        if (payload) {
          await options.onRender(surface.id, payload);
        }
      }
    }

    if (options.onEnd) {
      await options.onEnd();
    }
  } catch (error) {
    if (options.onError && error instanceof Error) {
      options.onError(error);
    } else {
      throw error;
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Process NDJSON string and return final Discord payloads
 */
export function processNdjson(
  ndjson: string,
  manager?: SurfaceManager
): Map<string, DiscordMessagePayload> {
  const mgr = manager ?? new SurfaceManager();
  const messages = parseNdjson(ndjson);

  mgr.processMessages(messages);

  return mgr.renderAllSurfaces();
}
