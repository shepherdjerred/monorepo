import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@shepherdjerred/scout-desktop/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-discord-blurple text-white hover:bg-discord-blurple/90 focus-visible:ring-discord-blurple",
        destructive: "bg-discord-red text-white hover:bg-discord-red/90 focus-visible:ring-discord-red",
        success: "bg-discord-green text-white hover:bg-discord-green/90 focus-visible:ring-discord-green",
        outline:
          "border border-gray-600 bg-transparent text-gray-200 hover:bg-gray-800 hover:text-white focus-visible:ring-gray-500",
        secondary: "bg-gray-700 text-gray-100 hover:bg-gray-600 focus-visible:ring-gray-500",
        ghost: "text-gray-300 hover:bg-gray-800 hover:text-white focus-visible:ring-gray-500",
        link: "text-discord-blurple underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 px-3 text-xs",
        lg: "h-12 px-6 text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean | undefined;
    loading?: boolean | undefined;
    icon?: ReactNode | undefined;
  };

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, icon, disabled, children, ...props }, ref) => {
    const Component = asChild ? Slot : "button";
    const isDisabled = disabled ?? loading;

    return (
      <Component
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={isDisabled}
        {...props}
      >
        {loading ? <Loader2 className="animate-spin" /> : icon && <span className="shrink-0">{icon}</span>}
        {children}
      </Component>
    );
  },
);
Button.displayName = "Button";

export { Button };
export type { ButtonProps };
