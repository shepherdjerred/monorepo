import type { CheckBoxComponent } from "../types";
import { useSurface } from "../SurfaceManager";
import {
  resolveString,
  resolveBoolean,
  resolveActionContext,
} from "../../hooks/useDataBinding";
import { Checkbox } from "@/components/ui/checkbox";

interface A2UICheckBoxProps {
  id: string;
  component: CheckBoxComponent["CheckBox"];
  surfaceId: string;
  dataModel: Record<string, unknown>;
}

export function A2UICheckBox({
  id,
  component,
  surfaceId,
  dataModel,
}: A2UICheckBoxProps) {
  const { dispatchAction } = useSurface();
  const label = resolveString(component.label, dataModel);
  const checked = resolveBoolean(component.value, dataModel);

  const handleCheckedChange = (newChecked: boolean) => {
    const resolvedContext = resolveActionContext(
      component.action.context,
      dataModel,
    );
    resolvedContext.value = newChecked;
    dispatchAction(surfaceId, id, component.action.name, resolvedContext);
  };

  return (
    <div className="flex items-center space-x-2">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={handleCheckedChange}
      />
      <label
        htmlFor={id}
        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
      >
        {label}
      </label>
    </div>
  );
}
