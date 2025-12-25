/**
 * Surface Manager
 * Manages A2UI surface state for Discord rendering
 */

import type {
  A2UIComponent,
  A2UIMessage,
  UserAction,
} from "./types.js";
import {
  isSurfaceUpdate,
  isDataModelUpdate,
  isBeginRendering,
  isDeleteSurface,
} from "./types.js";
import {
  mergeDataModel,
  dataModelEntriesToObject,
  type DataModel,
} from "./data-binding.js";
import { renderToDiscord, type DiscordMessagePayload } from "./renderer.js";

// ============= Types =============

export type Surface = {
  id: string;
  components: Map<string, A2UIComponent>;
  dataModel: DataModel;
  rootId: string | null;
  isRendering: boolean;
};

export type SurfaceState = Map<string, Surface>;

// ============= Surface Manager =============

export class SurfaceManager {
  private surfaces: SurfaceState = new Map();

  /**
   * Process an A2UI message and update surface state
   */
  processMessage(message: A2UIMessage): void {
    if (isSurfaceUpdate(message)) {
      const { surfaceId, components } = message.surfaceUpdate;
      let surface = this.surfaces.get(surfaceId);

      if (!surface) {
        surface = {
          id: surfaceId,
          components: new Map(),
          dataModel: {},
          rootId: null,
          isRendering: false,
        };
        this.surfaces.set(surfaceId, surface);
      }

      // Add/update components
      for (const component of components) {
        surface.components.set(component.id, component);
      }
    }

    if (isDataModelUpdate(message)) {
      const { surfaceId, path, contents } = message.dataModelUpdate;
      const surface = this.surfaces.get(surfaceId);

      if (surface) {
        surface.dataModel = mergeDataModel(surface.dataModel, contents, path);
      } else {
        // Create surface with just data model
        const newSurface: Surface = {
          id: surfaceId,
          components: new Map(),
          dataModel: dataModelEntriesToObject(contents),
          rootId: null,
          isRendering: false,
        };
        this.surfaces.set(surfaceId, newSurface);
      }
    }

    if (isBeginRendering(message)) {
      const { surfaceId, root } = message.beginRendering;
      const surface = this.surfaces.get(surfaceId);

      if (surface) {
        surface.rootId = root;
        surface.isRendering = true;
      }
    }

    if (isDeleteSurface(message)) {
      const { surfaceId } = message.deleteSurface;
      this.surfaces.delete(surfaceId);
    }
  }

  /**
   * Process multiple messages
   */
  processMessages(messages: A2UIMessage[]): void {
    for (const message of messages) {
      this.processMessage(message);
    }
  }

  /**
   * Get a surface by ID
   */
  getSurface(surfaceId: string): Surface | undefined {
    return this.surfaces.get(surfaceId);
  }

  /**
   * Get all surfaces
   */
  getAllSurfaces(): Surface[] {
    return Array.from(this.surfaces.values());
  }

  /**
   * Get all surfaces that are ready to render
   */
  getRenderableSurfaces(): Surface[] {
    return Array.from(this.surfaces.values()).filter(
      (s) => s.isRendering && s.rootId !== null
    );
  }

  /**
   * Render a surface to Discord message payload
   */
  renderSurface(surfaceId: string): DiscordMessagePayload | null {
    const surface = this.surfaces.get(surfaceId);

    if (!surface || !surface.isRendering || !surface.rootId) {
      return null;
    }

    return renderToDiscord(
      surface.rootId,
      Array.from(surface.components.values()),
      surface.dataModel,
      surfaceId
    );
  }

  /**
   * Render all renderable surfaces
   */
  renderAllSurfaces(): Map<string, DiscordMessagePayload> {
    const result = new Map<string, DiscordMessagePayload>();

    for (const surface of this.getRenderableSurfaces()) {
      const payload = this.renderSurface(surface.id);
      if (payload) {
        result.set(surface.id, payload);
      }
    }

    return result;
  }

  /**
   * Create a UserAction event
   */
  createUserAction(
    surfaceId: string,
    sourceComponentId: string,
    actionName: string,
    context: Record<string, unknown> = {}
  ): UserAction {
    return {
      userAction: {
        name: actionName,
        surfaceId,
        sourceComponentId,
        timestamp: new Date().toISOString(),
        context,
      },
    };
  }

  /**
   * Clear all surfaces
   */
  clear(): void {
    this.surfaces.clear();
  }

  /**
   * Clear a specific surface
   */
  clearSurface(surfaceId: string): void {
    this.surfaces.delete(surfaceId);
  }
}

/**
 * Create a new surface manager instance
 */
export function createSurfaceManager(): SurfaceManager {
  return new SurfaceManager();
}
