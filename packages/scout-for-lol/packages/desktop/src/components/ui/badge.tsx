import type { HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@scout-for-lol/desktop/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "bg-gray-700/80 text-gray-300 border-gray-600",
        success:
          "bg-discord-green/20 text-discord-green border-discord-green/30",
        warning:
          "bg-discord-yellow/20 text-discord-yellow border-discord-yellow/30",
        error: "bg-discord-red/20 text-discord-red border-discord-red/30",
        info: "bg-discord-blurple/20 text-discord-blurple border-discord-blurple/30",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

type BadgeProps = HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof badgeVariants> & {
    dot?: boolean;
    pulse?: boolean;
  };

const dotColors = {
  default: "bg-gray-400",
  success: "bg-discord-green",
  warning: "bg-discord-yellow",
  error: "bg-discord-red",
  info: "bg-discord-blurple",
};

function Badge({
  className,
  variant = "default",
  dot,
  pulse,
  children,
  ...props
}: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props}>
      {dot === true && (
        <span className="relative flex h-2 w-2">
          {pulse === true && (
            <span
              className={cn(
                "absolute inline-flex h-full w-full animate-ping rounded-full opacity-75",
                dotColors[variant ?? "default"],
              )}
            />
          )}
          <span
            className={cn(
              "relative inline-flex h-2 w-2 rounded-full",
              dotColors[variant ?? "default"],
            )}
          />
        </span>
      )}
      {children}
    </span>
  );
}

type StatusIndicatorProps = HTMLAttributes<HTMLSpanElement> & {
  status:
    | "connected"
    | "disconnected"
    | "connecting"
    | "idle"
    | "active"
    | "error";
  label?: string;
};

const statusConfig: Record<
  StatusIndicatorProps["status"],
  { variant: NonNullable<BadgeProps["variant"]>; text: string; pulse: boolean }
> = {
  connected: { variant: "success", text: "Connected", pulse: false },
  disconnected: { variant: "error", text: "Disconnected", pulse: false },
  connecting: { variant: "info", text: "Connecting...", pulse: true },
  idle: { variant: "default", text: "Idle", pulse: false },
  active: { variant: "success", text: "Active", pulse: true },
  error: { variant: "error", text: "Error", pulse: false },
};

function StatusIndicator({
  status,
  label,
  className,
  ...props
}: StatusIndicatorProps) {
  const config = statusConfig[status];

  return (
    <Badge
      variant={config.variant}
      dot
      pulse={config.pulse}
      className={className}
      {...props}
    >
      {label ?? config.text}
    </Badge>
  );
}

export { Badge, StatusIndicator };
