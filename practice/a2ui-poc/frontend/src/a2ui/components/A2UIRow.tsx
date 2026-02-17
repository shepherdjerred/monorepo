import type { RowComponent } from "../types";
import { ComponentRenderer } from "../ComponentRegistry";

interface A2UIRowProps {
  component: RowComponent["Row"];
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
  spaceAround: "justify-around",
  spaceBetween: "justify-between",
  spaceEvenly: "justify-evenly",
};

export function A2UIRow({ component, surfaceId }: A2UIRowProps) {
  const alignment =
    alignmentClasses[component.alignment || "center"] || "items-center";
  const distribution =
    distributionClasses[component.distribution || "start"] || "justify-start";

  // Handle explicit list children
  if ("explicitList" in component.children) {
    return (
      <div
        className={`flex flex-row flex-wrap gap-3 ${alignment} ${distribution}`}
      >
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

  // Template children not implemented for POC
  return <div className="text-gray-500">Template children not implemented</div>;
}
