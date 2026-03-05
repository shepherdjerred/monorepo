import { cn } from "@/lib/utils";

type BadgeVariant = "default" | "success" | "warning" | "error" | "info";

type BadgeProps = {
  variant?: BadgeVariant | undefined;
  children: React.ReactNode;
  className?: string | undefined;
};

const variantStyles: Record<BadgeVariant, string> = {
  default: "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200",
  success: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  warning:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  error: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  info: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
};

export function Badge({
  variant = "default",
  children,
  className,
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        variantStyles[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
