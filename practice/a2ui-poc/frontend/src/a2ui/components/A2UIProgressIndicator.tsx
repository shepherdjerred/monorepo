import type { ProgressIndicatorComponent } from "../types";
import { resolveNumber, resolveString } from "../../hooks/useDataBinding";

interface A2UIProgressIndicatorProps {
  component: ProgressIndicatorComponent["ProgressIndicator"];
  dataModel: Record<string, unknown>;
}

export function A2UIProgressIndicator({
  component,
  dataModel,
}: A2UIProgressIndicatorProps) {
  const progress = resolveNumber(component.progress, dataModel);
  const label = component.label
    ? resolveString(component.label, dataModel)
    : null;

  const percentage = Math.min(100, Math.max(0, progress * 100));

  return (
    <div className="w-full">
      {label && (
        <span className="text-sm text-gray-600 mb-1 block">{label}</span>
      )}
      <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
        <div
          className="bg-blue-600 h-2 rounded-full transition-all duration-300 ease-out"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
