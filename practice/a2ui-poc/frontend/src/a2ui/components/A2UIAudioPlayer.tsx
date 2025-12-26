import type { AudioPlayerComponent } from "../types";
import { resolveString } from "../../hooks/useDataBinding";

interface A2UIAudioPlayerProps {
  id: string;
  component: AudioPlayerComponent["AudioPlayer"];
  dataModel: Record<string, unknown>;
}

export function A2UIAudioPlayer({ component, dataModel }: A2UIAudioPlayerProps) {
  const url = resolveString(component.url, dataModel);
  const description = component.description
    ? resolveString(component.description, dataModel)
    : undefined;

  return (
    <div className="flex flex-col gap-2">
      {description && (
        <p className="text-sm text-gray-600">{description}</p>
      )}
      <audio src={url} controls className="w-full max-w-md" />
    </div>
  );
}
