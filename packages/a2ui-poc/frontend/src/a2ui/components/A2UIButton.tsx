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

export function A2UIButton({ id, component, surfaceId, dataModel }: A2UIButtonProps) {
  const { dispatchAction, surfaces } = useSurface();
  const surface = surfaces.get(surfaceId);
  const hasChild = surface?.components.has(component.child);

  const handleClick = () => {
    const resolvedContext = resolveActionContext(component.action.context, dataModel);
    dispatchAction(surfaceId, id, component.action.name, resolvedContext);
  };

  const baseClasses =
    "px-4 py-2 rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2";
  const variantClasses = component.primary
    ? "bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500"
    : "bg-gray-100 text-gray-800 hover:bg-gray-200 focus:ring-gray-400";

  return (
    <button
      onClick={handleClick}
      className={`${baseClasses} ${variantClasses}`}
    >
      {hasChild ? (
        <ComponentRenderer componentId={component.child} surfaceId={surfaceId} />
      ) : (
        "Button"
      )}
    </button>
  );
}
