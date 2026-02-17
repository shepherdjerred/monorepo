import type { MultipleChoiceComponent } from "../types";
import { useSurface } from "../SurfaceManager";
import {
  resolveString,
  resolveActionContext,
} from "../../hooks/useDataBinding";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface A2UIMultipleChoiceProps {
  id: string;
  component: MultipleChoiceComponent["MultipleChoice"];
  surfaceId: string;
  dataModel: Record<string, unknown>;
}

export function A2UIMultipleChoice({
  id,
  component,
  surfaceId,
  dataModel,
}: A2UIMultipleChoiceProps) {
  const { dispatchAction } = useSurface();
  const currentValue = resolveString(component.value, dataModel);
  const label = component.label
    ? resolveString(component.label, dataModel)
    : undefined;

  const handleValueChange = (newValue: string) => {
    const resolvedContext = resolveActionContext(
      component.action.context,
      dataModel,
    );
    resolvedContext.value = newValue;
    dispatchAction(surfaceId, id, component.action.name, resolvedContext);
  };

  return (
    <div className="flex flex-col gap-2">
      {label && (
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
      )}
      <Select value={currentValue} onValueChange={handleValueChange}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder="Select an option" />
        </SelectTrigger>
        <SelectContent>
          {component.options.map((option, index) => {
            const optionLabel = resolveString(option.label, dataModel);
            const optionValue = resolveString(option.value, dataModel);
            return (
              <SelectItem key={index} value={optionValue}>
                {optionLabel}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
}
