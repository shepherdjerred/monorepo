import type { DividerComponent } from "../types";

interface A2UIDividerProps {
  component: DividerComponent["Divider"];
}

export function A2UIDivider({ component }: A2UIDividerProps) {
  const isVertical = component.axis === "vertical";

  if (isVertical) {
    return <div className="w-px bg-gray-200 self-stretch mx-2" />;
  }

  return <hr className="border-gray-200 my-4 w-full" />;
}
