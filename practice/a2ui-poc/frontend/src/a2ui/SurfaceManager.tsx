import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import type {
  A2UIMessage,
  A2UIComponent,
  DataModelEntry,
  UserAction,
} from "./types";

export interface Surface {
  id: string;
  components: Map<string, A2UIComponent>;
  dataModel: Record<string, unknown>;
  rootId: string | null;
  isRendering: boolean;
  actionLoading: boolean;
}

interface SurfaceContextValue {
  surfaces: Map<string, Surface>;
  processMessage: (message: A2UIMessage) => void;
  dispatchAction: (
    surfaceId: string,
    componentId: string,
    actionName: string,
    context: Record<string, unknown>,
  ) => Promise<void>;
  clearSurfaces: () => void;
}

const SurfaceContext = createContext<SurfaceContextValue | null>(null);

export function useSurface() {
  const ctx = useContext(SurfaceContext);
  if (!ctx) {
    throw new Error("useSurface must be used within SurfaceProvider");
  }
  return ctx;
}

interface SurfaceProviderProps {
  children: ReactNode;
  onAction?: (action: UserAction) => Promise<A2UIMessage[]>;
}

/**
 * Apply data model entries to an object, handling nested structures
 */
function applyDataModelUpdate(
  current: Record<string, unknown>,
  contents: DataModelEntry[],
): Record<string, unknown> {
  const result = { ...current };

  for (const entry of contents) {
    if (entry.valueString !== undefined) {
      result[entry.key] = entry.valueString;
    } else if (entry.valueNumber !== undefined) {
      result[entry.key] = entry.valueNumber;
    } else if (entry.valueBoolean !== undefined) {
      result[entry.key] = entry.valueBoolean;
    } else if (entry.valueMap !== undefined) {
      result[entry.key] = applyDataModelUpdate(
        (result[entry.key] as Record<string, unknown>) || {},
        entry.valueMap,
      );
    }
  }

  return result;
}

export function SurfaceProvider({ children, onAction }: SurfaceProviderProps) {
  const [surfaces, setSurfaces] = useState<Map<string, Surface>>(new Map());

  const processMessage = useCallback((message: A2UIMessage) => {
    if ("surfaceUpdate" in message) {
      const { surfaceId, components } = message.surfaceUpdate;

      setSurfaces((prev) => {
        const next = new Map(prev);
        const existing = next.get(surfaceId);

        const surface: Surface = existing
          ? { ...existing, components: new Map(existing.components) }
          : {
              id: surfaceId,
              components: new Map(),
              dataModel: {},
              rootId: null,
              isRendering: false,
              actionLoading: false,
            };

        // Add/update components
        for (const comp of components) {
          surface.components.set(comp.id, comp);
        }

        next.set(surfaceId, surface);
        return next;
      });
    }

    if ("dataModelUpdate" in message) {
      const { surfaceId, contents } = message.dataModelUpdate;

      setSurfaces((prev) => {
        const next = new Map(prev);
        const surface = next.get(surfaceId);

        if (!surface) return prev;

        const newDataModel = applyDataModelUpdate(surface.dataModel, contents);
        next.set(surfaceId, { ...surface, dataModel: newDataModel });

        return next;
      });
    }

    if ("beginRendering" in message) {
      const { surfaceId, root } = message.beginRendering;

      setSurfaces((prev) => {
        const next = new Map(prev);
        const surface = next.get(surfaceId);

        if (!surface) return prev;

        next.set(surfaceId, { ...surface, rootId: root, isRendering: true });
        return next;
      });
    }

    if ("deleteSurface" in message) {
      const { surfaceId } = message.deleteSurface;

      setSurfaces((prev) => {
        const next = new Map(prev);
        next.delete(surfaceId);
        return next;
      });
    }
  }, []);

  const dispatchAction = useCallback(
    async (
      surfaceId: string,
      componentId: string,
      actionName: string,
      context: Record<string, unknown>,
    ) => {
      if (!onAction) return;

      // Set loading state
      setSurfaces((prev) => {
        const next = new Map(prev);
        const surface = next.get(surfaceId);
        if (surface) {
          next.set(surfaceId, { ...surface, actionLoading: true });
        }
        return next;
      });

      const action: UserAction = {
        name: actionName,
        surfaceId,
        sourceComponentId: componentId,
        timestamp: new Date().toISOString(),
        context,
      };

      try {
        const responseMessages = await onAction(action);
        for (const msg of responseMessages) {
          processMessage(msg);
        }
      } catch (error) {
        console.error("Failed to dispatch action:", error);
      } finally {
        // Clear loading state
        setSurfaces((prev) => {
          const next = new Map(prev);
          const surface = next.get(surfaceId);
          if (surface) {
            next.set(surfaceId, { ...surface, actionLoading: false });
          }
          return next;
        });
      }
    },
    [onAction, processMessage],
  );

  const clearSurfaces = useCallback(() => {
    setSurfaces(new Map());
  }, []);

  return (
    <SurfaceContext.Provider
      value={{ surfaces, processMessage, dispatchAction, clearSurfaces }}
    >
      {children}
    </SurfaceContext.Provider>
  );
}
