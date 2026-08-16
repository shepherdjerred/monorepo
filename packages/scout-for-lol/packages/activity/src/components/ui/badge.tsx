import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all focus-visible:border-activity-focus focus-visible:ring-[3px] focus-visible:ring-activity-focus/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-activity-danger aria-invalid:ring-activity-danger/20 dark:aria-invalid:ring-activity-danger/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default:
          "bg-activity-brand text-activity-on-brand [a]:hover:bg-activity-brand/80",
        secondary:
          "bg-activity-secondary text-activity-on-secondary [a]:hover:bg-activity-secondary/80",
        destructive:
          "bg-activity-danger/10 text-activity-danger focus-visible:ring-activity-danger/20 dark:bg-activity-danger/20 dark:focus-visible:ring-activity-danger/40 [a]:hover:bg-activity-danger/20",
        outline:
          "border-activity-line text-activity-ink [a]:hover:bg-activity-subtle [a]:hover:text-activity-muted-ink",
        ghost:
          "hover:bg-activity-subtle hover:text-activity-muted-ink dark:hover:bg-activity-subtle/50",
        link: "text-activity-brand underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props,
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  });
}

export { Badge, badgeVariants };
