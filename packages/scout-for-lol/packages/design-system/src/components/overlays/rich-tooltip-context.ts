import { createContext, type ReactElement, type ReactNode } from "react";

export type RichTooltipProps = {
  /**
   * The trigger: one element that takes a ref and DOM event handlers. It is
   * not wrapped, so a link stays a link and a button stays a button.
   */
  children: ReactElement;
  /** The layer's body. A tooltip never fetches; the body does its own loading. */
  content: ReactNode;
  /** Names the layer for assistive technology and the sheet. */
  label: string;
  /** Start open, for a tooltip that is shown in place. */
  defaultOpen?: boolean;
  /**
   * Called when the reader settles on the trigger or its layer, which is
   * earlier than the layer opening. Return a function to cancel the intent if
   * the layer never opens or has closed again.
   */
  onIntent?: () => (() => void) | undefined;
  /**
   * `auto` opens the layer on hover and focus, and a bottom sheet on a phone.
   * `popover` and `sheet` pin one or the other.
   */
  presentation?: "auto" | "popover" | "sheet";
};

/** What a layer exposes to the layers it contains. */
export type LayerContextValue = {
  /** The element a child layer sits beside. */
  contentElement: () => HTMLElement | null;
  childEngaged: (id: string, engaged: boolean) => void;
};

export const LayerContext = createContext<LayerContextValue | undefined>(
  undefined,
);

export type SheetEntry = { label: string; content: ReactNode };

/** Present inside a bottom sheet, where a part replaces the sheet's content. */
export const SheetContext = createContext<
  { push: (entry: SheetEntry) => void } | undefined
>(undefined);
