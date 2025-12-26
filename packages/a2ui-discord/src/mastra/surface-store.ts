/**
 * A2UI Surface Store
 * Tracks active A2UI surfaces per channel/message
 */

import type { Message, TextChannel } from "discord.js";
import { SurfaceManager, type DiscordMessagePayload } from "../index.js";
import type { A2UIMessage } from "../types.js";

export type ActiveSurface = {
  surfaceId: string;
  channelId: string;
  messageId: string | null;
  manager: SurfaceManager;
  createdAt: Date;
  updatedAt: Date;
  /** Callback for when a user interacts with this surface */
  onAction?: (action: SurfaceAction) => void | Promise<void>;
};

export type SurfaceAction = {
  surfaceId: string;
  componentId: string;
  actionName: string;
  context: Record<string, unknown>;
  userId: string;
  channelId: string;
  messageId: string;
};

/**
 * Store for tracking active A2UI surfaces
 */
class SurfaceStore {
  private surfaces = new Map<string, ActiveSurface>();

  /**
   * Create a new surface
   */
  create(
    surfaceId: string,
    channelId: string,
    onAction?: (action: SurfaceAction) => void | Promise<void>
  ): ActiveSurface {
    const surface: ActiveSurface = {
      surfaceId,
      channelId,
      messageId: null,
      manager: new SurfaceManager(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Add onAction only if defined
    if (onAction !== undefined) {
      surface.onAction = onAction;
    }

    this.surfaces.set(surfaceId, surface);
    return surface;
  }

  /**
   * Get a surface by ID
   */
  get(surfaceId: string): ActiveSurface | undefined {
    return this.surfaces.get(surfaceId);
  }

  /**
   * Get a surface by message ID
   */
  getByMessageId(messageId: string): ActiveSurface | undefined {
    for (const surface of this.surfaces.values()) {
      if (surface.messageId === messageId) {
        return surface;
      }
    }
    return undefined;
  }

  /**
   * Get all surfaces for a channel
   */
  getByChannelId(channelId: string): ActiveSurface[] {
    return Array.from(this.surfaces.values()).filter(
      (s) => s.channelId === channelId
    );
  }

  /**
   * Update the message ID for a surface (after sending to Discord)
   */
  setMessageId(surfaceId: string, messageId: string): void {
    const surface = this.surfaces.get(surfaceId);
    if (surface) {
      surface.messageId = messageId;
      surface.updatedAt = new Date();
    }
  }

  /**
   * Process A2UI messages for a surface
   */
  processMessages(surfaceId: string, messages: A2UIMessage[]): void {
    const surface = this.surfaces.get(surfaceId);
    if (surface) {
      surface.manager.processMessages(messages);
      surface.updatedAt = new Date();
    }
  }

  /**
   * Render a surface to Discord payload
   */
  render(surfaceId: string): DiscordMessagePayload | null {
    const surface = this.surfaces.get(surfaceId);
    if (!surface) {
      return null;
    }
    return surface.manager.renderSurface(surfaceId);
  }

  /**
   * Delete a surface
   */
  delete(surfaceId: string): boolean {
    return this.surfaces.delete(surfaceId);
  }

  /**
   * Clean up old surfaces (older than maxAge milliseconds)
   */
  cleanup(maxAge = 30 * 60 * 1000): number {
    const now = Date.now();
    let count = 0;

    for (const [id, surface] of this.surfaces) {
      if (now - surface.updatedAt.getTime() > maxAge) {
        this.surfaces.delete(id);
        count++;
      }
    }

    return count;
  }

  /**
   * Get total number of active surfaces
   */
  get size(): number {
    return this.surfaces.size;
  }

  /**
   * Clear all surfaces
   */
  clear(): void {
    this.surfaces.clear();
  }
}

// Singleton instance
let store: SurfaceStore | null = null;

/**
 * Get the global surface store instance
 */
export function getSurfaceStore(): SurfaceStore {
  store ??= new SurfaceStore();
  return store;
}

/**
 * Send or update an A2UI surface to a Discord channel
 */
export async function sendSurface(
  channel: TextChannel,
  surfaceId: string
): Promise<Message | null> {
  const store = getSurfaceStore();
  const surface = store.get(surfaceId);

  if (!surface) {
    return null;
  }

  const payload = store.render(surfaceId);
  if (!payload) {
    return null;
  }

  // If we already have a message, edit it
  if (surface.messageId) {
    try {
      const existingMessage = await channel.messages.fetch(surface.messageId);
      await existingMessage.edit({
        embeds: payload.embeds,
        components: payload.components,
      });
      return existingMessage;
    } catch {
      // Message was deleted or not found, send a new one
    }
  }

  // Send a new message
  const message = await channel.send({
    embeds: payload.embeds,
    components: payload.components,
  });

  store.setMessageId(surfaceId, message.id);
  return message;
}

/**
 * Update an existing surface message
 */
export async function updateSurface(
  channel: TextChannel,
  surfaceId: string,
  messages: A2UIMessage[]
): Promise<Message | null> {
  const store = getSurfaceStore();

  // Process new messages
  store.processMessages(surfaceId, messages);

  // Re-render and update Discord
  return sendSurface(channel, surfaceId);
}
