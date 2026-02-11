import type { HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { AlertCircle, CheckCircle2, Info, XCircle, Loader2, X } from "lucide-react";
import { cn } from "@shepherdjerred/scout-desktop/lib/utils";

const alertVariants = cva("relative flex items-start gap-4 rounded-lg border p-5 animate-fade-in", {
  variants: {
    variant: {
      default: "bg-gray-800/50 border-gray-700 text-gray-100",
      info: "bg-discord-blurple/10 border-discord-blurple/30 text-discord-blurple",
      success: "bg-discord-green/10 border-discord-green/30 text-discord-green",
      warning: "bg-discord-yellow/10 border-discord-yellow/30 text-discord-yellow",
      error: "bg-discord-red/10 border-discord-red/30 text-discord-red",
      loading: "bg-discord-blurple/10 border-discord-blurple/30 text-discord-blurple",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

const icons = {
  default: Info,
  info: Info,
  success: CheckCircle2,
  warning: AlertCircle,
  error: XCircle,
  loading: Loader2,
};

type AlertProps = HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof alertVariants> & {
    title?: string;
    onDismiss?: () => void;
  };

function Alert({ className, variant = "default", title, children, onDismiss, ...props }: AlertProps) {
  const IconComponent = icons[variant ?? "default"];
  const isLoading = variant === "loading";

  return (
    <div className={cn(alertVariants({ variant }), className)} role="alert" {...props}>
      <IconComponent className={cn("h-5 w-5 shrink-0 mt-0.5", isLoading && "animate-spin")} />
      <div className="flex-1 min-w-0">
        {title && <p className="font-medium mb-2">{title}</p>}
        <p className="text-sm opacity-90">{children}</p>
      </div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="shrink-0 p-1 rounded-md hover:bg-white/10 transition-colors"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

export { Alert };
