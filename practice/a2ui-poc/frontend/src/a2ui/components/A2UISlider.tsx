import type { SliderComponent } from "../types";
import { useSurface } from "../SurfaceManager";
import {
  resolveNumber,
  resolveString,
  resolveActionContext,
} from "../../hooks/useDataBinding";
import { Slider } from "@/components/ui/slider";

interface A2UISliderProps {
  id: string;
  component: SliderComponent["Slider"];
  surfaceId: string;
  dataModel: Record<string, unknown>;
}

export function A2UISlider({
  id,
  component,
  surfaceId,
  dataModel,
}: A2UISliderProps) {
  const { dispatchAction } = useSurface();
  const currentValue = resolveNumber(component.value, dataModel);
  const min = resolveNumber(component.min, dataModel);
  const max = resolveNumber(component.max, dataModel);
  const step = component.step ? resolveNumber(component.step, dataModel) : 1;
  const label = component.label
    ? resolveString(component.label, dataModel)
    : undefined;

  const handleValueChange = (values: number[]) => {
    const newValue = values[0] ?? currentValue;
    const resolvedContext = resolveActionContext(
      component.action.context,
      dataModel,
    );
    resolvedContext.value = newValue;
    dispatchAction(surfaceId, id, component.action.name, resolvedContext);
  };

  return (
    <div className="flex flex-col gap-3">
      {label && (
        <div className="flex justify-between items-center">
          <label htmlFor={id} className="text-sm font-medium">
            {label}
          </label>
          <span className="text-sm text-gray-600">{currentValue}</span>
        </div>
      )}
      <Slider
        id={id}
        value={[currentValue]}
        onValueChange={handleValueChange}
        min={min}
        max={max}
        step={step}
        className="w-full"
      />
    </div>
  );
}
