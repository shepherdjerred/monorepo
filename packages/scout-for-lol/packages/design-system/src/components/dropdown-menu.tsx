import * as DropdownPrimitive from "@radix-ui/react-dropdown-menu";
import { Check, ChevronRight, Circle } from "lucide-react";
import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "#src/lib/cn.ts";

export const DropdownMenu = DropdownPrimitive.Root;
export const DropdownMenuTrigger = DropdownPrimitive.Trigger;
export const DropdownMenuGroup = DropdownPrimitive.Group;
export const DropdownMenuPortal = DropdownPrimitive.Portal;
export const DropdownMenuSub = DropdownPrimitive.Sub;
export const DropdownMenuRadioGroup = DropdownPrimitive.RadioGroup;

export const DropdownMenuContent = forwardRef<
  React.ComponentRef<typeof DropdownPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <DropdownPrimitive.Portal>
    <DropdownPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn("scout-menu", className)}
      {...props}
    />
  </DropdownPrimitive.Portal>
));
DropdownMenuContent.displayName = "DropdownMenuContent";
export const DropdownMenuSubContent = forwardRef<
  React.ComponentRef<typeof DropdownPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof DropdownPrimitive.SubContent>
>(({ className, ...props }, ref) => (
  <DropdownPrimitive.Portal>
    <DropdownPrimitive.SubContent
      ref={ref}
      className={cn("scout-menu", className)}
      {...props}
    />
  </DropdownPrimitive.Portal>
));
DropdownMenuSubContent.displayName = "DropdownMenuSubContent";
export const DropdownMenuItem = forwardRef<
  React.ComponentRef<typeof DropdownPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownPrimitive.Item>
>(({ className, ...props }, ref) => (
  <DropdownPrimitive.Item
    ref={ref}
    className={cn("scout-menu-item", className)}
    {...props}
  />
));
DropdownMenuItem.displayName = "DropdownMenuItem";
export const DropdownMenuSubTrigger = forwardRef<
  React.ComponentRef<typeof DropdownPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof DropdownPrimitive.SubTrigger>
>(({ className, children, ...props }, ref) => (
  <DropdownPrimitive.SubTrigger
    ref={ref}
    className={cn("scout-menu-item", className)}
    {...props}
  >
    {children}
    <ChevronRight aria-hidden="true" size={16} />
  </DropdownPrimitive.SubTrigger>
));
DropdownMenuSubTrigger.displayName = "DropdownMenuSubTrigger";
export const DropdownMenuCheckboxItem = forwardRef<
  React.ComponentRef<typeof DropdownPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof DropdownPrimitive.CheckboxItem>
>(({ className, children, ...props }, ref) => (
  <DropdownPrimitive.CheckboxItem
    ref={ref}
    className={cn("scout-menu-item", className)}
    {...props}
  >
    <DropdownPrimitive.ItemIndicator>
      <Check aria-hidden="true" size={16} />
    </DropdownPrimitive.ItemIndicator>
    {children}
  </DropdownPrimitive.CheckboxItem>
));
DropdownMenuCheckboxItem.displayName = "DropdownMenuCheckboxItem";
export const DropdownMenuRadioItem = forwardRef<
  React.ComponentRef<typeof DropdownPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof DropdownPrimitive.RadioItem>
>(({ className, children, ...props }, ref) => (
  <DropdownPrimitive.RadioItem
    ref={ref}
    className={cn("scout-menu-item", className)}
    {...props}
  >
    <DropdownPrimitive.ItemIndicator>
      <Circle aria-hidden="true" size={9} fill="currentColor" />
    </DropdownPrimitive.ItemIndicator>
    {children}
  </DropdownPrimitive.RadioItem>
));
DropdownMenuRadioItem.displayName = "DropdownMenuRadioItem";
export const DropdownMenuLabel = forwardRef<
  React.ComponentRef<typeof DropdownPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof DropdownPrimitive.Label>
>(({ className, ...props }, ref) => (
  <DropdownPrimitive.Label
    ref={ref}
    className={cn("scout-menu-item", className)}
    {...props}
  />
));
DropdownMenuLabel.displayName = "DropdownMenuLabel";
export const DropdownMenuSeparator = forwardRef<
  React.ComponentRef<typeof DropdownPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownPrimitive.Separator
    ref={ref}
    className={cn("scout-menu-separator", className)}
    {...props}
  />
));
DropdownMenuSeparator.displayName = "DropdownMenuSeparator";
export function DropdownMenuShortcut({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("scout-muted", className)} {...props} />;
}
