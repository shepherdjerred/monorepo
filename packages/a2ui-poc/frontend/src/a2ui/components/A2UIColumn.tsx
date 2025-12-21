import type { ColumnComponent } from "../types";
import { ComponentRenderer } from "../ComponentRegistry";

interface A2UIColumnProps {
  component: ColumnComponent["Column"];
  surfaceId: string;
}

const alignmentClasses: Record<string, string> = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
  stretch: "items-stretch",
};

const distributionClasses: Record<string, string> = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
  spaceBetween: "justify-between",
  spaceAround: "justify-around",
  spaceEvenly: "justify-evenly",
};

export function A2UIColumn({ component, surfaceId }: A2UIColumnProps) {
  const alignment = alignmentClasses[component.alignment || "stretch"] || "items-stretch";
  const distribution = distributionClasses[component.distribution || "start"] || "justify-start";

  // Handle explicit list children
  if ("explicitList" in component.children) {
    return (
      <div className={`flex flex-col gap-4 ${alignment} ${distribution}`}>
        {component.children.explicitList.map((childId) => (
          <ComponentRenderer
            key={childId}
            componentId={childId}
            surfaceId={surfaceId}
          />
        ))}
      </div>
    );
  }

  // Template children would need data model iteration - not implemented for POC
  return <div className="text-gray-500">Template children not implemented</div>;
}
