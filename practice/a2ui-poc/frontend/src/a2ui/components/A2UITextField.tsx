import { useState } from "react";
import type { TextFieldComponent } from "../types";
import { useSurface } from "../SurfaceManager";
import {
  resolveString,
  resolveActionContext,
} from "../../hooks/useDataBinding";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

interface A2UITextFieldProps {
  id: string;
  component: TextFieldComponent["TextField"];
  surfaceId: string;
  dataModel: Record<string, unknown>;
}

export function A2UITextField({
  id,
  component,
  surfaceId,
  dataModel,
}: A2UITextFieldProps) {
  const { dispatchAction } = useSurface();
  const initialValue = resolveString(component.value, dataModel);
  const [value, setValue] = useState(initialValue);
  const placeholder = component.placeholder
    ? resolveString(component.placeholder, dataModel)
    : "";
  const label = component.label
    ? resolveString(component.label, dataModel)
    : undefined;

  const handleChange = (newValue: string) => {
    setValue(newValue);
    const resolvedContext = resolveActionContext(
      component.action.context,
      dataModel,
    );
    resolvedContext.value = newValue;
    dispatchAction(surfaceId, id, component.action.name, resolvedContext);
  };

  const renderField = () => {
    switch (component.type) {
      case "longText":
        return (
          <Textarea
            id={id}
            value={value}
            onChange={(e) => handleChange(e.target.value)}
            placeholder={placeholder}
            rows={4}
          />
        );
      case "number":
        return (
          <Input
            id={id}
            type="number"
            value={value}
            onChange={(e) => handleChange(e.target.value)}
            placeholder={placeholder}
          />
        );
      case "date":
        return (
          <Input
            id={id}
            type="date"
            value={value}
            onChange={(e) => handleChange(e.target.value)}
            placeholder={placeholder}
          />
        );
      case "obscured":
        return (
          <Input
            id={id}
            type="password"
            value={value}
            onChange={(e) => handleChange(e.target.value)}
            placeholder={placeholder}
          />
        );
      case "shortText":
      default:
        return (
          <Input
            id={id}
            type="text"
            value={value}
            onChange={(e) => handleChange(e.target.value)}
            placeholder={placeholder}
          />
        );
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {label && (
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
      )}
      {renderField()}
    </div>
  );
}
