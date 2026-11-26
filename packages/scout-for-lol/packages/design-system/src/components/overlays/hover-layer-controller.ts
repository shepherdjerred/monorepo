/**
 * The timing rules of one tooltip layer, kept apart from React so they can be
 * tested with fake timers.
 *
 * A layer is *engaged* while the pointer or focus is in its trigger, in its
 * content, or in any descendant layer. It opens after a delay when the pointer
 * enters the trigger, immediately when the trigger takes keyboard focus, and
 * closes a short grace period after it stops being engaged so the pointer can
 * travel from the trigger into the layer.
 */

/** Hover must settle this long on a trigger before its layer opens. */
export const RICH_TOOLTIP_OPEN_DELAY = 350;
/** A layer stays open this long after the pointer leaves it. */
export const RICH_TOOLTIP_CLOSE_DELAY = 150;

export type LayerTimers<Handle> = {
  setTimeout: (callback: () => void, milliseconds: number) => Handle;
  clearTimeout: (handle: Handle) => void;
};

export type LayerControllerOptions<Handle> = {
  initialOpen: boolean;
  openDelay?: number;
  closeDelay?: number;
  /** The layer should now be open or closed. */
  onOpenChange: (open: boolean) => void;
  /** The layer became engaged or stopped being engaged. */
  onEngagedChange?: (engaged: boolean) => void;
  timers: LayerTimers<Handle>;
};

export type LayerController = {
  isOpen: () => boolean;
  isEngaged: () => boolean;
  /** The pointer entered or left the trigger. */
  pointerTrigger: (inside: boolean) => void;
  /** The pointer entered or left the layer's content. */
  pointerContent: (inside: boolean) => void;
  /** The trigger gained or lost keyboard focus. */
  focusTrigger: (inside: boolean) => void;
  /** Focus entered or left the layer's content. */
  focusContent: (inside: boolean) => void;
  /** A descendant layer became engaged or stopped being engaged. */
  childEngaged: (id: string, engaged: boolean) => void;
  /** Open now, without the hover delay. */
  open: () => void;
  /** Close now, without the grace period. */
  close: () => void;
  /** Drop timers and report disengagement; the layer is going away. */
  dispose: () => void;
};

export function createLayerController<Handle>(
  options: LayerControllerOptions<Handle>,
): LayerController {
  const { timers } = options;
  const openDelay = options.openDelay ?? RICH_TOOLTIP_OPEN_DELAY;
  const closeDelay = options.closeDelay ?? RICH_TOOLTIP_CLOSE_DELAY;

  let open = options.initialOpen;
  let pointerTrigger = false;
  let pointerContent = false;
  let focusTrigger = false;
  let focusContent = false;
  const children = new Set<string>();
  let reported = false;
  let openTimer: Handle | undefined;
  let closeTimer: Handle | undefined;

  const engaged = (): boolean =>
    pointerTrigger ||
    pointerContent ||
    focusTrigger ||
    focusContent ||
    children.size > 0;

  function clearOpenTimer(): void {
    if (openTimer !== undefined) timers.clearTimeout(openTimer);
    openTimer = undefined;
  }

  function clearCloseTimer(): void {
    if (closeTimer !== undefined) timers.clearTimeout(closeTimer);
    closeTimer = undefined;
  }

  function setOpen(next: boolean): void {
    if (open === next) return;
    open = next;
    if (!next) {
      // The content unmounts without firing its own leave events.
      pointerContent = false;
      focusContent = false;
      children.clear();
    }
    options.onOpenChange(next);
  }

  /** Re-derive what the layer owes the world after any flag changed. */
  function settle(): void {
    const now = engaged();
    if (now !== reported) {
      reported = now;
      options.onEngagedChange?.(now);
    }
    if (now) {
      clearCloseTimer();
      return;
    }
    clearOpenTimer();
    if (open && closeTimer === undefined) {
      closeTimer = timers.setTimeout(() => {
        closeTimer = undefined;
        if (!engaged()) setOpen(false);
        settle();
      }, closeDelay);
    }
  }

  return {
    isOpen: () => open,
    isEngaged: engaged,
    pointerTrigger: (inside) => {
      pointerTrigger = inside;
      if (inside && !open && openTimer === undefined) {
        openTimer = timers.setTimeout(() => {
          openTimer = undefined;
          if (pointerTrigger) setOpen(true);
          settle();
        }, openDelay);
      }
      settle();
    },
    pointerContent: (inside) => {
      pointerContent = inside;
      settle();
    },
    focusTrigger: (inside) => {
      focusTrigger = inside;
      if (inside) {
        clearOpenTimer();
        setOpen(true);
      }
      settle();
    },
    focusContent: (inside) => {
      focusContent = inside;
      settle();
    },
    childEngaged: (id, isEngaged) => {
      if (isEngaged) children.add(id);
      else children.delete(id);
      settle();
    },
    open: () => {
      clearOpenTimer();
      setOpen(true);
      settle();
    },
    close: () => {
      clearOpenTimer();
      clearCloseTimer();
      setOpen(false);
      settle();
    },
    dispose: () => {
      clearOpenTimer();
      clearCloseTimer();
      pointerTrigger = false;
      pointerContent = false;
      focusTrigger = false;
      focusContent = false;
      children.clear();
      if (reported) {
        reported = false;
        options.onEngagedChange?.(false);
      }
    },
  };
}
