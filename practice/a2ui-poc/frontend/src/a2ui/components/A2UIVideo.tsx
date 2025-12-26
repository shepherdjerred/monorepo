import type { VideoComponent } from "../types";
import { resolveString } from "../../hooks/useDataBinding";

interface A2UIVideoProps {
  id: string;
  component: VideoComponent["Video"];
  dataModel: Record<string, unknown>;
}

export function A2UIVideo({ component, dataModel }: A2UIVideoProps) {
  const url = resolveString(component.url, dataModel);
  const autoplay = component.autoplay ?? false;
  const loop = component.loop ?? false;

  return (
    <video
      src={url}
      controls
      autoPlay={autoplay}
      loop={loop}
      className="w-full max-w-2xl rounded-lg"
    />
  );
}
