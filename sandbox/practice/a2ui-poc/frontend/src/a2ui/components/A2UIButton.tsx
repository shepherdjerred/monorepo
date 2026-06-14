import { Loader2 } from "lucide-react";
import type { ButtonComponent } from "../types";
import { useSurface } from "../SurfaceManager";
import { resolveActionContext } from "../../hooks/useDataBinding";
import { ComponentRenderer } from "../ComponentRegistry";

interface A2UIButtonProps {
  id: string;
  component: ButtonComponent["Button"];
  surfaceId: string;
  dataModel: Record<string, unknown>;
}

export function A2UIButton({
  id,
  component,
  surfaceId,
  dataModel,
}: A2UIButtonProps) {
  const { dispatchAction, surfaces } = useSurface();
  const surface = surfaces.get(surfaceId);
  const hasChild = surface?.components.has(component.child);
  const isLoading = surface?.actionLoading ?? false;

  const handleClick = () => {
    const resolvedContext = resolveActionContext(
      component.action.context,
      dataModel,
    );
    dispatchAction(surfaceId, id, component.action.name, resolvedContext);
  };

  const baseClasses =
    "px-4 py-2 rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 flex items-center gap-2";
  const variantClasses = component.primary
    ? "bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500 disabled:bg-blue-400 disabled:cursor-not-allowed"
    : "bg-gray-100 text-gray-800 hover:bg-gray-200 focus:ring-gray-400 disabled:bg-gray-50 disabled:cursor-not-allowed";

  return (
    <button
      onClick={handleClick}
      disabled={isLoading}
      className={`${baseClasses} ${variantClasses}`}
    >
      {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
      {hasChild ? (
        <ComponentRenderer
          componentId={component.child}
          surfaceId={surfaceId}
        />
      ) : (
        "Button"
      )}
    </button>
  );
}
