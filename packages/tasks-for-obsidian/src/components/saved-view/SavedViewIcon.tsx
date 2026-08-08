import React from "react";
import type { FeatherIconName } from "@react-native-vector-icons/feather";

import { PlatformSymbol } from "../common/PlatformSymbol";

export const SAVED_VIEW_SYMBOL_OPTIONS = [
  { symbol: "tray", icon: "inbox", label: "Inbox" },
  { symbol: "briefcase", icon: "briefcase", label: "Briefcase" },
  { symbol: "book.closed", icon: "book-open", label: "Book" },
  { symbol: "scope", icon: "target", label: "Focus" },
  { symbol: "star", icon: "star", label: "Star" },
  { symbol: "calendar", icon: "calendar", label: "Calendar" },
  { symbol: "flag", icon: "flag", label: "Flag" },
  { symbol: "bookmark", icon: "bookmark", label: "Bookmark" },
] as const;

function fallbackIcon(symbol: string): FeatherIconName {
  return (
    SAVED_VIEW_SYMBOL_OPTIONS.find((option) => option.symbol === symbol)
      ?.icon ?? "bookmark"
  );
}

type Props = {
  readonly symbol: string;
  readonly size: number;
  readonly color: string;
};

export function SavedViewIcon({ symbol, size, color }: Props) {
  return (
    <PlatformSymbol
      symbol={symbol}
      fallback={fallbackIcon(symbol)}
      size={size}
      color={color}
    />
  );
}
