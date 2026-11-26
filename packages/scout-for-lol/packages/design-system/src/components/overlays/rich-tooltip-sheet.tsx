import { Slot } from "@radix-ui/react-slot";
import { ChevronLeft } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import {
  BottomSheet,
  BottomSheetContent,
} from "#src/components/overlays/bottom-sheet.tsx";
import {
  SheetContext,
  type RichTooltipProps,
  type SheetEntry,
} from "#src/components/overlays/rich-tooltip-context.ts";

/**
 * A part tapped inside a bottom sheet. There is no second layer on a phone:
 * the part's content replaces the sheet's.
 */
export function RichTooltipSheetPart(
  props: Pick<RichTooltipProps, "children" | "content" | "label"> & {
    push: (entry: SheetEntry) => void;
  },
) {
  const { content, label, push } = props;
  return (
    <Slot
      onClick={(event: React.MouseEvent) => {
        event.preventDefault();
        push({ label, content });
      }}
    >
      {props.children}
    </Slot>
  );
}

/** The top-level layer on a phone: a tap opens the content in a bottom sheet. */
export function RichTooltipSheet(props: RichTooltipProps) {
  const { children, content, label, defaultOpen = false } = props;
  const [open, setOpen] = useState(defaultOpen);
  const [pushed, setPushed] = useState<SheetEntry[]>([]);
  const triggerRef = useRef<HTMLElement | null>(null);

  const sheet = useMemo(
    () => ({
      push: (entry: SheetEntry) => {
        setPushed((current) => [...current, entry]);
      },
    }),
    [],
  );

  const trail: SheetEntry[] = [{ label, content }, ...pushed];
  const current = trail.at(-1);
  const previous = trail.at(-2);
  if (current === undefined) throw new Error("A sheet always has one entry");

  return (
    <>
      <Slot
        ref={triggerRef}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={(event: React.MouseEvent) => {
          event.preventDefault();
          setOpen(true);
        }}
      >
        {children}
      </Slot>
      <BottomSheet
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setPushed([]);
        }}
      >
        <BottomSheetContent
          title={<span className="scout-sr-only">{current.label}</span>}
          className="scout-rich-tooltip-sheet"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            triggerRef.current?.focus();
          }}
        >
          <SheetContext.Provider value={sheet}>
            {previous === undefined ? null : (
              <button
                type="button"
                className="scout-rich-tooltip__back"
                onClick={() => {
                  setPushed((entries) => entries.slice(0, -1));
                }}
              >
                <ChevronLeft size={18} aria-hidden="true" />
                Back to {previous.label}
              </button>
            )}
            <div
              key={trail.length}
              className="scout-tooltip scout-tooltip--sheet"
            >
              {current.content}
            </div>
          </SheetContext.Provider>
        </BottomSheetContent>
      </BottomSheet>
    </>
  );
}
