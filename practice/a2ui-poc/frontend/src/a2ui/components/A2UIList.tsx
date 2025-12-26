import type { ListComponent } from "../types";
import { ComponentRenderer } from "../ComponentRegistry";

interface A2UIListProps {
  id: string;
  component: ListComponent["List"];
  surfaceId: string;
  dataModel: Record<string, unknown>;
}

export function A2UIList({ component, surfaceId }: A2UIListProps) {
  const direction = component.direction || "vertical";
  const alignment = component.alignment || "stretch";

  // Only support explicit children for now
  if (!("explicitList" in component.children)) {
    console.warn("List component currently only supports explicit children");
    return null;
  }

  const children = component.children.explicitList;
  const isVertical = direction === "vertical";

  const containerClasses = [
    "flex",
    isVertical ? "flex-col" : "flex-row",
    "gap-2",
  ];

  // Apply alignment
  const alignmentMap = {
    start: isVertical ? "items-start" : "items-start",
    center: isVertical ? "items-center" : "items-center",
    end: isVertical ? "items-end" : "items-end",
    stretch: isVertical ? "items-stretch" : "items-stretch",
  };
  containerClasses.push(alignmentMap[alignment as keyof typeof alignmentMap]);

  return (
    <div className={containerClasses.join(" ")}>
      {children.map((childId) => (
        <ComponentRenderer
          key={childId}
          componentId={childId}
          surfaceId={surfaceId}
        />
      ))}
    </div>
  );
}
