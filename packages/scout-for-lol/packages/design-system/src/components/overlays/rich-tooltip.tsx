import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Slot } from "@radix-ui/react-slot";
import {
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
} from "react";
import { createLayerController } from "#src/components/overlays/hover-layer-controller.ts";
import {
  LayerContext,
  SheetContext,
  type RichTooltipProps as TooltipProps,
} from "#src/components/overlays/rich-tooltip-context.ts";
import {
  RichTooltipSheet,
  RichTooltipSheetPart,
} from "#src/components/overlays/rich-tooltip-sheet.tsx";
import { cn } from "#src/lib/cn.ts";
import { useMediaQuery } from "#src/lib/use-media-query.ts";

/** Below this width there is no hover, and a tap opens a bottom sheet. */
export const RICH_TOOLTIP_PHONE_QUERY = "(max-width: 639.98px)";

const TABBABLE =
  'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Offset of a child layer from its parent's edge; negative overlaps it. */
const CHILD_SIDE_OFFSET = -12;

/**
 * A layered tooltip. Hovering the trigger opens the layer after a short delay,
 * focusing it opens the layer at once, and the layer stays open while the
 * pointer or focus is in it or in a layer it opened. A `RichTooltip` placed
 * inside another one's `content` is a part: its layer opens beside its
 * parent's. Escape closes the top layer only.
 *
 * Keyboard: a focused trigger shows its layer; Enter, Space (on a button) or
 * the right arrow moves focus into it, and Escape returns to the trigger.
 *
 * Under 640px wide a tap opens the content in a bottom sheet instead, and a
 * tapped part replaces the sheet's content with a back control.
 */
export function RichTooltip(props: TooltipProps) {
  const sheet = useContext(SheetContext);
  const phone = useMediaQuery(RICH_TOOLTIP_PHONE_QUERY);
  if (sheet !== undefined) {
    return (
      <RichTooltipSheetPart
        content={props.content}
        label={props.label}
        push={sheet.push}
      >
        {props.children}
      </RichTooltipSheetPart>
    );
  }
  const presentation = props.presentation ?? "auto";
  return presentation === "sheet" || (presentation === "auto" && phone) ? (
    <RichTooltipSheet {...props} />
  ) : (
    <RichTooltipPopover {...props} />
  );
}

/** The soft panel a tooltip body sits in, for showing one in place. */
export function RichTooltipPanel({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("scout-tooltip scout-tooltip--static", className)}
      {...props}
    />
  );
}

function focusLayer(content: HTMLElement | null): void {
  if (content === null) return;
  (content.querySelector<HTMLElement>(TABBABLE) ?? content).focus();
}

function RichTooltipPopover(props: TooltipProps) {
  const { children, content, label, defaultOpen = false, onIntent } = props;
  const parent = useContext(LayerContext);
  const id = useId();
  const contentId = `${id}-layer`;
  const [open, setOpen] = useState(defaultOpen);

  const triggerRef = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const pointerTypeRef = useRef("mouse");
  const enterOnOpenRef = useRef(false);
  const returnFocusRef = useRef(false);
  const suppressFocusRef = useRef(false);
  const cancelIntentRef = useRef<(() => void) | undefined>(undefined);

  // The controller outlives renders but its callbacks must see current props.
  const latest = useRef({ onIntent, parent });
  useEffect(() => {
    latest.current = { onIntent, parent };
  });

  const [controller] = useState(() =>
    createLayerController({
      initialOpen: defaultOpen,
      onOpenChange: setOpen,
      onEngagedChange: (engaged) => {
        latest.current.parent?.childEngaged(id, engaged);
        if (engaged) {
          cancelIntentRef.current = latest.current.onIntent?.();
        } else {
          cancelIntentRef.current?.();
          cancelIntentRef.current = undefined;
        }
      },
      timers: {
        setTimeout: (callback, milliseconds) =>
          globalThis.setTimeout(callback, milliseconds),
        clearTimeout: (handle) => {
          globalThis.clearTimeout(handle);
        },
      },
    }),
  );
  useEffect(
    () => () => {
      controller.dispose();
    },
    [controller],
  );

  const layer = useMemo(
    () => ({
      contentElement: () => contentRef.current,
      childEngaged: (childId: string, engaged: boolean) => {
        controller.childEngaged(childId, engaged);
      },
    }),
    [controller],
  );

  // A child layer sits beside its parent's edge, level with the part that
  // opened it; a top-level layer sits under its trigger.
  const anchorRef = useMemo(
    () => ({
      current: {
        getBoundingClientRect: (): DOMRect => {
          const trigger =
            triggerRef.current?.getBoundingClientRect() ?? new DOMRect();
          const parentElement = parent?.contentElement();
          if (parentElement === null || parentElement === undefined) {
            return trigger;
          }
          const edge = parentElement.getBoundingClientRect();
          return new DOMRect(
            edge.left,
            trigger.top,
            edge.width,
            trigger.height,
          );
        },
        get contextElement(): Element | undefined {
          return triggerRef.current ?? undefined;
        },
      },
    }),
    [parent],
  );

  const enterLayer = useCallback(() => {
    if (controller.isOpen()) {
      focusLayer(contentRef.current);
      return;
    }
    enterOnOpenRef.current = true;
    controller.open();
  }, [controller]);

  const isTrigger = (target: EventTarget): boolean =>
    target instanceof Node && triggerRef.current?.contains(target) === true;

  return (
    <LayerContext.Provider value={layer}>
      <PopoverPrimitive.Root
        open={open}
        onOpenChange={(next) => {
          if (!next) controller.close();
        }}
      >
        <PopoverPrimitive.Anchor virtualRef={anchorRef} />
        <Slot
          ref={triggerRef}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? contentId : undefined}
          onPointerEnter={(event: React.PointerEvent) => {
            if (event.pointerType !== "touch") controller.pointerTrigger(true);
          }}
          onPointerLeave={(event: React.PointerEvent) => {
            if (event.pointerType !== "touch") controller.pointerTrigger(false);
          }}
          onPointerDown={(event: React.PointerEvent) => {
            pointerTypeRef.current = event.pointerType;
          }}
          onClick={(event: React.MouseEvent) => {
            // No hover on touch: the first tap shows the layer, the second
            // follows the link.
            if (pointerTypeRef.current === "touch" && !controller.isOpen()) {
              event.preventDefault();
              controller.open();
            }
          }}
          onFocus={(event: React.FocusEvent<HTMLElement>) => {
            if (suppressFocusRef.current) {
              suppressFocusRef.current = false;
              return;
            }
            if (event.currentTarget.matches(":focus-visible")) {
              controller.focusTrigger(true);
            }
          }}
          onBlur={() => {
            controller.focusTrigger(false);
          }}
          onKeyDown={(event: React.KeyboardEvent<HTMLElement>) => {
            if (event.altKey || event.ctrlKey || event.metaKey) return;
            const isLink = event.currentTarget instanceof HTMLAnchorElement;
            const enters =
              event.key === "ArrowRight" ||
              (!isLink && (event.key === "Enter" || event.key === " "));
            if (!enters) return;
            event.preventDefault();
            enterLayer();
          }}
        >
          {children}
        </Slot>
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            ref={contentRef}
            id={contentId}
            aria-label={label}
            side={parent === undefined ? "bottom" : "right"}
            align="start"
            sideOffset={parent === undefined ? 10 : CHILD_SIDE_OFFSET}
            collisionPadding={12}
            // A child tracks its parent, which is itself still being placed.
            updatePositionStrategy={
              parent === undefined ? "optimized" : "always"
            }
            className="scout-tooltip"
            onOpenAutoFocus={(event) => {
              if (enterOnOpenRef.current) {
                enterOnOpenRef.current = false;
                return;
              }
              // A layer opened by hover or by focus on its trigger leaves
              // focus where it is.
              event.preventDefault();
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (!returnFocusRef.current) return;
              returnFocusRef.current = false;
              suppressFocusRef.current = true;
              triggerRef.current?.focus();
            }}
            onEscapeKeyDown={() => {
              returnFocusRef.current =
                contentRef.current?.contains(document.activeElement) === true;
            }}
            onInteractOutside={(event) => {
              // The trigger is outside the content but not outside the layer.
              if (event.target !== null && isTrigger(event.target)) {
                event.preventDefault();
              }
            }}
            onPointerEnter={() => {
              controller.pointerContent(true);
            }}
            onPointerLeave={() => {
              controller.pointerContent(false);
            }}
            onFocus={() => {
              controller.focusContent(true);
            }}
            onBlur={(event) => {
              const next = event.relatedTarget;
              if (
                !(next instanceof Node) ||
                !event.currentTarget.contains(next)
              ) {
                controller.focusContent(false);
              }
            }}
          >
            {content}
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
    </LayerContext.Provider>
  );
}
