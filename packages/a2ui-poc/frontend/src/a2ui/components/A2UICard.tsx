import type { CardComponent } from "../types";
import { ComponentRenderer } from "../ComponentRegistry";

interface A2UICardProps {
  component: CardComponent["Card"];
  surfaceId: string;
}

export function A2UICard({ component, surfaceId }: A2UICardProps) {
  return (
    <div className="bg-white rounded-xl shadow-lg p-6 border border-gray-100">
      <ComponentRenderer componentId={component.child} surfaceId={surfaceId} />
    </div>
  );
}
