import { useState } from "react";
import type { DateTimeInputComponent } from "../types";
import { useSurface } from "../SurfaceManager";
import { resolveString, resolveActionContext } from "../../hooks/useDataBinding";
import { Input } from "@/components/ui/input";

interface A2UIDateTimeInputProps {
  id: string;
  component: DateTimeInputComponent["DateTimeInput"];
  surfaceId: string;
  dataModel: Record<string, unknown>;
}

export function A2UIDateTimeInput({
  id,
  component,
  surfaceId,
  dataModel,
}: A2UIDateTimeInputProps) {
  const { dispatchAction } = useSurface();
  const initialValue = resolveString(component.value, dataModel);
  const [value, setValue] = useState(initialValue);
  const label = component.label
    ? resolveString(component.label, dataModel)
    : undefined;

  const handleChange = (newValue: string) => {
    setValue(newValue);
    const resolvedContext = resolveActionContext(component.action.context, dataModel);
    resolvedContext.value = newValue;
    dispatchAction(surfaceId, id, component.action.name, resolvedContext);
  };

  const inputType = component.type === "datetime" ? "datetime-local" : component.type;

  return (
    <div className="flex flex-col gap-2">
      {label && (
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
      )}
      <Input
        id={id}
        type={inputType}
        value={value}
        onChange={(e) => handleChange(e.target.value)}
      />
    </div>
  );
}
