import { Drawer as DrawerPrimitive } from "@base-ui/react/drawer";
import { createContext, useContext, useMemo, type ComponentProps } from "react";
import { useScoutPortalContainer } from "./portal.tsx";
import { cn } from "#src/lib/cn.ts";

type DrawerContextValue = {
  modal: DrawerPrimitive.Root.Props["modal"];
  showSwipeHandle: boolean;
  swipeDirection: NonNullable<DrawerPrimitive.Root.Props["swipeDirection"]>;
};

const DrawerContext = createContext<DrawerContextValue | null>(null);

function useDrawer(): DrawerContextValue {
  const value = useContext(DrawerContext);
  if (value === null) throw new Error("Drawer parts must be inside Drawer");
  return value;
}

export function Drawer({
  modal = true,
  showSwipeHandle = false,
  swipeDirection = "down",
  ...props
}: DrawerPrimitive.Root.Props & { showSwipeHandle?: boolean }) {
  const value = useMemo(
    () => ({ modal, showSwipeHandle, swipeDirection }),
    [modal, showSwipeHandle, swipeDirection],
  );
  return (
    <DrawerContext.Provider value={value}>
      <DrawerPrimitive.Root
        modal={modal}
        swipeDirection={swipeDirection}
        {...props}
      />
    </DrawerContext.Provider>
  );
}

export function DrawerTrigger(props: DrawerPrimitive.Trigger.Props) {
  return <DrawerPrimitive.Trigger {...props} />;
}

export function DrawerPortal({
  container,
  ...props
}: DrawerPrimitive.Portal.Props) {
  const sharedContainer = useScoutPortalContainer();
  return (
    <DrawerPrimitive.Portal
      container={container ?? sharedContainer}
      {...props}
    />
  );
}

export function DrawerOverlay({
  className,
  ...props
}: DrawerPrimitive.Backdrop.Props) {
  return (
    <DrawerPrimitive.Backdrop
      className={cn("scout-drawer__overlay", className)}
      {...props}
    />
  );
}

export function DrawerSwipeHandle({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      aria-hidden="true"
      className={cn("scout-drawer__swipe-handle", className)}
      {...props}
    />
  );
}

export function DrawerContent({
  className,
  children,
  ...props
}: DrawerPrimitive.Popup.Props) {
  const { modal, showSwipeHandle, swipeDirection } = useDrawer();
  const swipeAxis =
    swipeDirection === "down" || swipeDirection === "up" ? "y" : "x";
  return (
    <DrawerPortal>
      {modal === true && <DrawerOverlay />}
      <DrawerPrimitive.Viewport
        className="scout-drawer__viewport"
        data-modal={modal}
      >
        <DrawerPrimitive.Popup
          className={cn("scout-drawer", className)}
          data-swipe-axis={swipeAxis}
          {...props}
        >
          {showSwipeHandle && <DrawerSwipeHandle />}
          <DrawerPrimitive.Content className="scout-drawer__content">
            {children}
          </DrawerPrimitive.Content>
        </DrawerPrimitive.Popup>
      </DrawerPrimitive.Viewport>
    </DrawerPortal>
  );
}

export function DrawerHeader({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("scout-drawer__header", className)} {...props} />;
}

export function DrawerTitle({
  className,
  ...props
}: DrawerPrimitive.Title.Props) {
  return (
    <DrawerPrimitive.Title
      className={cn("scout-drawer__title", className)}
      {...props}
    />
  );
}

export function DrawerDescription({
  className,
  ...props
}: DrawerPrimitive.Description.Props) {
  return (
    <DrawerPrimitive.Description
      className={cn("scout-drawer__description", className)}
      {...props}
    />
  );
}
