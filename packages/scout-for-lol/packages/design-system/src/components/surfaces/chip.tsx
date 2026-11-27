import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentPropsWithRef, HTMLAttributes } from "react";
import { cn } from "#src/lib/cn.ts";

export const chipVariants = cva("scout-chip", {
  variants: {
    variant: {
      default: "",
      ghost: "scout-chip--ghost",
      float: "scout-chip--float",
      go: "scout-chip--go",
    },
  },
  defaultVariants: { variant: "default" },
});

type ChipBaseProps = VariantProps<typeof chipVariants> & {
  /**
   * The chip is the selected one of its set. A button reports it as
   * `aria-pressed`; a link reports it as `aria-current`, because a link is
   * navigation, not a toggle.
   */
  pressed?: boolean;
};

export type ChipButtonProps = ChipBaseProps &
  ComponentPropsWithRef<"button"> & { href?: undefined };

export type ChipLinkProps = ChipBaseProps &
  ComponentPropsWithRef<"a"> & { href: string };

export type ChipProps = ChipButtonProps | ChipLinkProps;

/**
 * A pill for a filter, a toggle or an action. Renders a `button` unless it is
 * given an `href`, in which case it renders an `a`.
 */
export function Chip(props: ChipProps) {
  if (props.href !== undefined) {
    const { className, pressed, variant, ...rest } = props;
    return (
      <a
        {...rest}
        className={cn(chipVariants({ variant }), className)}
        aria-current={pressed === true ? "true" : rest["aria-current"]}
      />
    );
  }
  const { className, pressed, type = "button", variant, ...rest } = props;
  return (
    <button
      {...rest}
      type={type}
      className={cn(chipVariants({ variant }), className)}
      aria-pressed={pressed ?? rest["aria-pressed"]}
    />
  );
}

/** A small disc inside a chip, such as a champion face or a tier crest. */
export function ChipLane({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("scout-chip__lane", className)} {...props} />;
}
