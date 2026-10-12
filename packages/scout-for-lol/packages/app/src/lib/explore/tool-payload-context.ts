import { createContext } from "react";

export const ToolPayloadContext = createContext<{
  conversationId: string;
  shareToken: string | null;
} | null>(null);
