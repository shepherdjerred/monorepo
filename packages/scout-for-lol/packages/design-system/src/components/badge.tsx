import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "#src/lib/cn.ts";

export const badgeVariants = cva("scout-badge", {
  variants: {
    variant: {
      default: "scout-badge--primary",
      secondary: "scout-badge--secondary",
      outline: "scout-badge--outline",
      destructive: "scout-badge--danger",
    },
  },
  defaultVariants: { variant: "default" },
});

export type BadgeProps = HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}
