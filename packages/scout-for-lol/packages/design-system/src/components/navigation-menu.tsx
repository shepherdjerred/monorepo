import * as NavigationPrimitive from "@radix-ui/react-navigation-menu";
import { forwardRef } from "react";
import { cn } from "#src/lib/cn.ts";

export const NavigationMenu = forwardRef<
  React.ComponentRef<typeof NavigationPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof NavigationPrimitive.Root>
>(({ className, children, ...props }, ref) => (
  <NavigationPrimitive.Root ref={ref} className={className} {...props}>
    {children}
    <NavigationPrimitive.Viewport className="scout-popover" />
  </NavigationPrimitive.Root>
));
NavigationMenu.displayName = "NavigationMenu";
export const NavigationMenuList = forwardRef<
  React.ComponentRef<typeof NavigationPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof NavigationPrimitive.List>
>(({ className, ...props }, ref) => (
  <NavigationPrimitive.List
    ref={ref}
    className={cn("scout-navbar__links", className)}
    {...props}
  />
));
export const NavigationMenuItem = NavigationPrimitive.Item;
export const NavigationMenuTrigger = forwardRef<
  React.ComponentRef<typeof NavigationPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof NavigationPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <NavigationPrimitive.Trigger
    ref={ref}
    className={cn("scout-navbar__link", className)}
    {...props}
  />
));
export const NavigationMenuContent = NavigationPrimitive.Content;
export const NavigationMenuLink = forwardRef<
  React.ComponentRef<typeof NavigationPrimitive.Link>,
  React.ComponentPropsWithoutRef<typeof NavigationPrimitive.Link>
>(({ className, ...props }, ref) => (
  <NavigationPrimitive.Link
    ref={ref}
    className={cn("scout-navbar__link", className)}
    {...props}
  />
));
NavigationMenuList.displayName = "NavigationMenuList";
NavigationMenuTrigger.displayName = "NavigationMenuTrigger";
NavigationMenuLink.displayName = "NavigationMenuLink";
