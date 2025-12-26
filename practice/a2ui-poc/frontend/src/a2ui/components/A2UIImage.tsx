import type { ImageComponent } from "../types";
import { resolveString } from "../../hooks/useDataBinding";

interface A2UIImageProps {
  id: string;
  component: ImageComponent["Image"];
  dataModel: Record<string, unknown>;
}

export function A2UIImage({ component, dataModel }: A2UIImageProps) {
  const url = resolveString(component.url, dataModel);
  const fit = component.fit || "contain";
  const usageHint = component.usageHint;

  const objectFitMap = {
    contain: "object-contain",
    cover: "object-cover",
    fill: "object-fill",
    none: "object-none",
    "scale-down": "object-scale-down",
  };

  const sizeMap = {
    icon: "w-6 h-6",
    avatar: "w-12 h-12 rounded-full",
    smallFeature: "w-32 h-32",
    mediumFeature: "w-64 h-64",
    largeFeature: "w-96 h-96",
    header: "w-full h-48",
  };

  const classes = [
    objectFitMap[fit],
    usageHint ? sizeMap[usageHint] : "max-w-full h-auto",
  ];

  return (
    <img
      src={url}
      alt=""
      className={classes.join(" ")}
    />
  );
}
