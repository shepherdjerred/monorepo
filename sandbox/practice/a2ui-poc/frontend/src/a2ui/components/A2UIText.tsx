import type { TextComponent } from "../types";
import { resolveString } from "../../hooks/useDataBinding";

interface A2UITextProps {
  component: TextComponent["Text"];
  dataModel: Record<string, unknown>;
}

const usageHintClasses: Record<string, string> = {
  h1: "text-3xl font-bold text-gray-900",
  h2: "text-2xl font-semibold text-gray-800",
  h3: "text-xl font-medium text-gray-700",
  h4: "text-lg font-medium text-gray-700",
  h5: "text-base font-medium text-gray-600",
  body: "text-base text-gray-700",
  caption: "text-sm text-gray-500",
};

export function A2UIText({ component, dataModel }: A2UITextProps) {
  const text = resolveString(component.text, dataModel);
  const className = usageHintClasses[component.usageHint || "body"];

  return <span className={className}>{text}</span>;
}
