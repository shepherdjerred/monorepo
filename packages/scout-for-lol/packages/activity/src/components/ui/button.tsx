import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-activity-focus focus-visible:ring-3 focus-visible:ring-activity-focus/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-activity-danger aria-invalid:ring-3 aria-invalid:ring-activity-danger/20 dark:aria-invalid:border-activity-danger/50 dark:aria-invalid:ring-activity-danger/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-activity-brand text-activity-on-brand hover:bg-activity-brand/80",
        outline:
          "border-activity-line bg-activity-canvas hover:bg-activity-subtle hover:text-activity-ink aria-expanded:bg-activity-subtle aria-expanded:text-activity-ink dark:border-activity-field dark:bg-activity-field/30 dark:hover:bg-activity-field/50",
        secondary:
          "bg-activity-secondary text-activity-on-secondary hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-activity-secondary aria-expanded:text-activity-on-secondary",
        ghost:
          "hover:bg-activity-subtle hover:text-activity-ink aria-expanded:bg-activity-subtle aria-expanded:text-activity-ink dark:hover:bg-activity-subtle/50",
        destructive:
          "bg-activity-danger/10 text-activity-danger hover:bg-activity-danger/20 focus-visible:border-activity-danger/40 focus-visible:ring-activity-danger/20 dark:bg-activity-danger/20 dark:hover:bg-activity-danger/30 dark:focus-visible:ring-activity-danger/40",
        link: "text-activity-brand underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-8",
        "icon-xs":
          "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
