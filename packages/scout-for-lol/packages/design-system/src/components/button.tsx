import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "#src/lib/cn.ts";

export const buttonVariants = cva("scout-button", {
  variants: {
    variant: {
      default: "scout-button--primary",
      secondary: "scout-button--secondary",
      outline: "scout-button--outline",
      ghost: "scout-button--ghost",
      link: "scout-button--link",
      destructive: "scout-button--danger",
    },
    size: {
      default: "",
      sm: "scout-button--small",
      lg: "scout-button--large",
      icon: "scout-button--icon",
      "icon-sm": "scout-button--icon-small",
    },
  },
  defaultVariants: { variant: "default", size: "default" },
});

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ asChild = false, className, size, variant, ...props }, ref) => {
    const Component = asChild ? Slot : "button";
    return (
      <Component
        ref={ref}
        className={cn(buttonVariants({ size, variant }), className)}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export function IconButton({
  label,
  size = "icon",
  ...props
}: Omit<ButtonProps, "size"> & {
  label: string;
  size?: "icon" | "icon-sm";
}) {
  return <Button {...props} size={size} aria-label={label} />;
}
