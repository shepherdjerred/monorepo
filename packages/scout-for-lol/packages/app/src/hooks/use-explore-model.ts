import { useState } from "react";
import type { ExploreConversation } from "@scout-for-lol/data";

export function useExploreModel(
  conversationId: string | null,
  preferred: NonNullable<ExploreConversation["preferredModel"]>,
  enabled: boolean,
) {
  const [choices, setChoices] = useState<Record<string, typeof preferred>>({});
  const key = conversationId ?? "new";
  const model = choices[key] ?? preferred;
  return {
    model,
    requestModel: enabled ? model : undefined,
    chooseModel: (choice: typeof preferred) => {
      setChoices((current) => ({ ...current, [key]: choice }));
    },
  };
}
